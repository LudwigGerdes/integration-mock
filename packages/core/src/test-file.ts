import type { FaultSpec } from './types.js';

/** Pinned boundary items for a node (seam S8). */
export interface PinnedItem {
	json: unknown;
	binary?: Record<string, unknown>;
	pairedItem?: unknown;
}

export interface TestGiven {
	snapshot?: string;
	packs?: string[];
	seed?: Record<string, Record<string, unknown[]>>;
	faults?: Record<string, FaultSpec>;
	pinData?: Record<string, PinnedItem[]>;
}

export interface TestWhen {
	trigger?: 'manual' | 'webhook' | { node: string; payload?: unknown };
	payload?: unknown;
	timeout?: string;
}

/** Assertions are a loose map: dotted keys plus `calls` and `noUnmatched`. */
export type TestThen = Record<string, unknown>;

export interface TestCase {
	id: string;
	title?: string;
	given?: TestGiven;
	when: TestWhen;
	then?: TestThen;
}

export interface NormalizedTestFile {
	workflow?: string;
	instance?: string;
	cases: TestCase[];
}

const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Resolve a test file to a flat list of cases (suite seam S2).
 *
 * File-level `given` supplies defaults and a case's own `given` overrides it key
 * by key — replacing `faults` wholesale rather than deep-merging, so a case that
 * sets a fault gets exactly the faults it names and nothing inherited.
 *
 * The single-case form (top-level `when`/`then`) normalises to one case with the
 * id `default`, so a consumer only ever handles the list shape.
 */
export function normalizeTestFile(raw: unknown): NormalizedTestFile {
	const file = obj(raw);
	const fileGiven = obj(file.given) as TestGiven;

	const out: NormalizedTestFile = { cases: [] };
	if (typeof file.workflow === 'string') out.workflow = file.workflow;
	if (typeof file.instance === 'string') out.instance = file.instance;

	const merge = (caseGiven: unknown): TestGiven | undefined => {
		const merged = { ...fileGiven, ...(obj(caseGiven) as TestGiven) };
		return Object.keys(merged).length ? merged : undefined;
	};

	const build = (id: string, entry: Record<string, unknown>): TestCase => {
		const c: TestCase = { id, when: obj(entry.when) as TestWhen };
		if (typeof entry.title === 'string') c.title = entry.title;
		const given = merge(entry.given);
		if (given !== undefined) c.given = given;
		if (entry.then !== undefined) c.then = obj(entry.then);
		// Key order matters only for readability; the shape is what consumers compare.
		return { id: c.id, ...(c.title !== undefined ? { title: c.title } : {}), ...(c.given ? { given: c.given } : {}), when: c.when, ...(c.then ? { then: c.then } : {}) };
	};

	if (Array.isArray(file.cases)) {
		out.cases = file.cases.map((entry, i) => {
			const e = obj(entry);
			return build(typeof e.id === 'string' ? e.id : `case-${i}`, e);
		});
		return out;
	}

	out.cases = [build('default', file)];
	return out;
}
