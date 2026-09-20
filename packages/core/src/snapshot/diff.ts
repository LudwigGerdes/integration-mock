import { matchRoute } from '../matcher.js';
import type { LogEntry, MockRequest, Route, Snapshot } from '../types.js';
import { hashNode, outputsOf } from './build.js';
import type { N8nExecution } from './n8n-client.js';

export interface SnapshotDiff {
	changedNodes: string[];
	nodeOutputs: Record<string, { itemsBefore: number; itemsAfter: number; changedPaths: string[] }>;
	calls: {
		added: LogEntry[];
		missing: Route[];
		changed: Array<{ route: Route; entry: LogEntry; bodyDiff: string[] }>;
		unmatched: LogEntry[];
	};
}

const isObj = (v: unknown): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Dotted paths where two values differ; `[i]` for array positions. */
export function deepDiffPaths(a: unknown, b: unknown, prefix = ''): string[] {
	if (Array.isArray(a) && Array.isArray(b)) {
		const out: string[] = [];
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			out.push(...deepDiffPaths(a[i], b[i], `${prefix}[${i}]`));
		}
		return out;
	}
	if (isObj(a) && isObj(b)) {
		const ao = a as Record<string, unknown>;
		const bo = b as Record<string, unknown>;
		const out: string[] = [];
		for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
			out.push(...deepDiffPaths(ao[k], bo[k], prefix ? `${prefix}.${k}` : k));
		}
		return out;
	}
	return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix || '$'];
}

const asReq = (e: LogEntry): MockRequest => ({
	method: e.method,
	host: '',
	path: e.path,
	query: e.query,
	headers: e.reqHeaders,
	body: e.reqBody,
});

/**
 * Compare a baseline snapshot with a later execution and the calls the proxy saw.
 *
 * This is the primary signal for an agent iterating on a workflow: what changed
 * in the workflow, what changed in the data, and which outbound calls drifted.
 */
export function diffSnapshot(base: Snapshot, exec: N8nExecution, log: LogEntry[]): SnapshotDiff {
	const wf = exec.workflowData;
	const now = Object.fromEntries(wf.nodes.map((n) => [n.name, hashNode(n)]));
	const names = new Set([...Object.keys(base.nodeHashes), ...Object.keys(now)]);
	// A node present on only one side has an undefined hash there, so it counts
	// as changed — added and removed nodes are exactly what the user wants flagged.
	const changedNodes = [...names].filter((n) => base.nodeHashes[n] !== now[n]);

	const nodeOutputs: SnapshotDiff['nodeOutputs'] = {};
	for (const n of new Set([
		...Object.keys(base.nodeOutputs),
		...Object.keys(exec.data.resultData.runData),
	])) {
		const before = base.nodeOutputs[n] ?? [];
		const after = outputsOf(exec, n);
		nodeOutputs[n] = {
			itemsBefore: before.length,
			itemsAfter: after.length,
			changedPaths: deepDiffPaths(before, after),
		};
	}

	const unmatched = log.filter((e) => e.matchedRoute === 'unmatched');
	const usable = log.filter((e) => e.matchedRoute !== 'unmatched');
	const consumed = new Set<string>();
	const missing: Route[] = [];
	const changed: SnapshotDiff['calls']['changed'] = [];

	for (const pack of base.packs) {
		for (const route of pack.routes) {
			// Body is compared separately so a changed body reports as `changed`,
			// not as the route having gone `missing`.
			const hit = usable.find(
				(e) =>
					!consumed.has(e.id) &&
					e.service === pack.id &&
					matchRoute({ ...route, match: { ...route.match, bodyMatch: undefined } }, asReq(e)),
			);
			if (!hit) {
				missing.push(route);
				continue;
			}
			consumed.add(hit.id);
			if (route.match.bodyMatch !== undefined) {
				const bodyDiff = deepDiffPaths(route.match.bodyMatch, hit.reqBody);
				if (bodyDiff.length) changed.push({ route, entry: hit, bodyDiff });
			}
		}
	}

	const added = usable.filter((e) => !consumed.has(e.id));
	return { changedNodes, nodeOutputs, calls: { added, missing, changed, unmatched } };
}
