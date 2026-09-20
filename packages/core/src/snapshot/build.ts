import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { redact } from '../redact.js';
import type { Route, ServicePack, Snapshot } from '../types.js';
import { mapperFor, resolveNodeUrl } from './mappers.js';
import type { N8nExecution, N8nNode, N8nWorkflow } from './n8n-client.js';

/** Nodes that make no outbound call — they simply re-execute against the mock. */
const IGNORED = new Set(
	[
		'set',
		'if',
		'switch',
		'merge',
		'code',
		'noOp',
		'manualTrigger',
		'scheduleTrigger',
		'webhook',
		'splitInBatches',
		'filter',
		'sort',
		'aggregate',
		'itemLists',
		'executeWorkflow',
	].map((t) => `n8n-nodes-base.${t}`),
);

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export const hashNode = (n: N8nNode): string =>
	sha({ type: n.type, typeVersion: n.typeVersion, parameters: n.parameters });

/** Canvas position is not behaviour, so moving a node must not look like an edit. */
export const hashWorkflow = (w: N8nWorkflow): string =>
	sha({
		nodes: [...w.nodes]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((n) => ({
				name: n.name,
				type: n.type,
				typeVersion: n.typeVersion,
				parameters: n.parameters,
			})),
		connections: w.connections,
	});

export const snapshotPath = (workflowId: string, executionId: string, cwd = process.cwd()): string =>
	join(cwd, '.integration-mock', 'snapshots', workflowId, `${executionId}.json`);

/**
 * Where the untouched `GET /executions/:id?includeData=true` payload is kept
 * (suite seam S4).
 *
 * A derived snapshot is lossy and integration-mock's own format; canvas and the test
 * runner need the API's real bytes, so the export is written beside it.
 */
export const executionExportPath = (
	workflowId: string,
	executionId: string,
	cwd = process.cwd(),
): string => join(cwd, '.integration-mock', 'snapshots', workflowId, `${executionId}.export.json`);

/** Flatten a node's runs into the json payloads it emitted, skipping failed runs. */
export function outputsOf(exec: N8nExecution, nodeName: string): unknown[] {
	return (exec.data.resultData.runData[nodeName] ?? [])
		.filter((r) => !r.error)
		.flatMap((r) => (r.data?.main?.[0] ?? []).map((i) => i.json));
}

/**
 * Turn a finished execution into replayable mock data.
 *
 * Warnings never abort: a snapshot with partial fidelity still makes the retry
 * loop work, and the warnings say exactly where it will fall through.
 */
export function buildSnapshot(
	exec: N8nExecution,
	opts: { instance: string; redact?: Parameters<typeof redact>[1] },
): Snapshot {
	const wf = exec.workflowData;
	const warnings: string[] = [];
	const nodeOutputs: Record<string, unknown[]> = {};
	const byService = new Map<string, ServicePack>();

	for (const node of wf.nodes) {
		if (!exec.data.resultData.runData[node.name]) continue;
		const outputs = outputsOf(exec, node.name);
		nodeOutputs[node.name] = outputs;
		if (IGNORED.has(node.type) || node.type.endsWith('Trigger')) continue;

		const mapper = mapperFor(node.type);
		if (!mapper) {
			warnings.push(`${node.name} (${node.type}): no reverse-mapper; library defaults will serve`);
			continue;
		}

		const routes: Route[] = mapper.fromNodeOutput(node, outputs);
		if (routes.length === 0) {
			if (node.type === 'n8n-nodes-base.httpRequest') {
				warnings.push(`${node.name}: dynamic URL; cannot derive route`);
			} else {
				const { resource, operation } = node.parameters as {
					resource?: string;
					operation?: string;
				};
				warnings.push(
					`${node.name}: ${node.type} ${String(resource)}/${String(operation)} not supported by reverse-mapper`,
				);
			}
			continue;
		}

		for (const r of routes) {
			const service = r.id.split(':')[0]!;
			let pack = byService.get(service);
			if (!pack) {
				const url = resolveNodeUrl(node);
				const domains = mapper.domains ?? (url ? [url.hostname] : []);
				pack = {
					id: service,
					domains,
					prefix: `/${service}`,
					routes: [],
					source: `snapshot:${exec.id}`,
				};
				byService.set(service, pack);
			}
			const dup = pack.routes.filter((x) => x.id.startsWith(r.id.replace(/#\d+$/, '#'))).length;
			pack.routes.push({ ...r, id: r.id.replace(/#\d+$/, `#${dup}`) });
		}
	}

	const nodeHashes = Object.fromEntries(wf.nodes.map((n) => [n.name, hashNode(n)]));

	// Redact the captured payloads only. A sha256 hex digest is indistinguishable
	// from a token to the redactor, so redacting the whole snapshot would blank
	// every hash and make each node look edited on the next diff.
	const safe = redact({ packs: [...byService.values()], nodeOutputs }, opts.redact);

	return {
		executionId: exec.id,
		workflowId: wf.id,
		instance: opts.instance,
		createdAt: Date.now(),
		workflowHash: hashWorkflow(wf),
		nodeHashes,
		packs: safe.packs,
		nodeOutputs: safe.nodeOutputs,
		warnings,
	};
}
