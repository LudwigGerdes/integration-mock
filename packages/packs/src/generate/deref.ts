import type { OpenApiDoc } from './openapi.js';

/** Local `#/a/b` refs only. External documents are out of scope — see the build report. */
export function resolveRef(doc: OpenApiDoc, ref: string): unknown | null {
	if (!ref.startsWith('#/')) return null;
	let cur: unknown = doc;
	for (const rawPart of ref.slice(2).split('/')) {
		const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
		if (cur === null || typeof cur !== 'object') return null;
		cur = (cur as Record<string, unknown>)[part];
		if (cur === undefined) return null;
	}
	return cur;
}

/**
 * How deep to inline before giving up and returning `{}`.
 *
 * Comfortably deeper than `fakeFromSchema`'s own cap, so bounding here never
 * starves the value it feeds — but finite, because ref graphs are diamonds, not
 * just chains. A schema referenced twice per level expands 2^depth times, which
 * is how a real vendor spec exhausted a 4 GB heap.
 */
const MAX_DEREF_DEPTH = 12;

/**
 * Inline every `$ref` in a subtree.
 *
 * `seen` tracks the refs on the current path only, and is added to and removed
 * from in place: a self-referential schema (a User with a `manager: User`)
 * collapses to `{}` rather than recursing forever, while a schema legitimately
 * reused by two siblings still expands in both. Copying the set at each ref
 * instead — as this once did — makes allocation quadratic in the graph.
 */
export function derefDeep(
	doc: OpenApiDoc,
	node: unknown,
	seen: Set<string> = new Set(),
	depth = 0,
): unknown {
	if (depth > MAX_DEREF_DEPTH) return {};
	if (Array.isArray(node)) return node.map((n) => derefDeep(doc, n, seen, depth + 1));
	if (node === null || typeof node !== 'object') return node;

	const obj = node as Record<string, unknown>;
	const ref = obj.$ref;
	if (typeof ref === 'string') {
		if (seen.has(ref)) return {};
		const target = resolveRef(doc, ref);
		if (target === null) return {};
		seen.add(ref);
		const out = derefDeep(doc, target, seen, depth + 1);
		seen.delete(ref);
		return out;
	}

	const out: Record<string, unknown> = {};
	for (const k of Object.keys(obj)) out[k] = derefDeep(doc, obj[k], seen, depth + 1);
	return out;
}
