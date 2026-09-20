import picomatch from 'picomatch';
import type { MockRequest, Route } from './types.js';

const split = (p: string): string[] =>
	p
		.replace(/\/+$/, '')
		.split('/')
		.filter((s, i) => (i === 0 ? true : s !== ''));

/**
 * Match a path pattern against a concrete path.
 *
 * Grammar (per segment): `:name` captures one segment, `*` matches exactly one
 * segment, `**` matches zero or more segments, and a segment containing `*`
 * elsewhere is treated as a glob over that single segment.
 *
 * @returns captured params, or `null` when the path does not match.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
	const ps = split(pattern);
	const xs = split(path);
	const params: Record<string, string> = {};

	const go = (i: number, j: number): boolean => {
		if (i === ps.length) return j === xs.length;
		const seg = ps[i]!;
		if (seg === '**') {
			for (let k = j; k <= xs.length; k++) if (go(i + 1, k)) return true;
			return false;
		}
		if (j >= xs.length) return false;
		const x = xs[j]!;
		if (seg === '*') return go(i + 1, j + 1);
		if (seg.startsWith(':')) {
			params[seg.slice(1)] = x;
			return go(i + 1, j + 1);
		}
		if (seg.includes('*')) return picomatch.isMatch(x, seg) && go(i + 1, j + 1);
		return seg === x && go(i + 1, j + 1);
	};

	return go(0, 0) ? params : null;
}

/** Is this segment one that matches exactly one arbitrary segment? */
const isAnySingle = (seg: string): boolean => seg === '*' || seg.startsWith(':');

/**
 * Does pattern `a` match every concrete path that pattern `b` matches?
 *
 * Used to detect a route that can never serve because an earlier one already
 * covers it — `/things/:id` above `/things/describe` is the same defect as a
 * duplicate route, expressed through the grammar rather than by repetition.
 *
 * Deliberately CONSERVATIVE: it returns true only when subsumption is certain.
 * A false "this route is dead" would be worse than silence, so uncertain cases
 * (glob against glob, `**` on the right) answer false.
 */
export function pathSubsumes(a: string, b: string): boolean {
	const as = split(a);
	const bs = split(b);

	const go = (i: number, j: number): boolean => {
		if (i === as.length) return j === bs.length;
		const ai = as[i]!;

		if (ai === '**') {
			// Absorb any number of b's remaining segments.
			for (let k = j; k <= bs.length; k++) if (go(i + 1, k)) return true;
			return false;
		}
		if (j >= bs.length) return false;
		const bj = bs[j]!;

		// b spans an unbounded run here and a does not: a cannot cover it.
		if (bj === '**') return false;

		// One arbitrary segment covers any single-segment pattern.
		if (isAnySingle(ai)) return go(i + 1, j + 1);

		if (ai.includes('*')) {
			// A glob covers a literal it matches; against another pattern we
			// cannot decide cheaply, so only an exact repeat counts.
			if (isAnySingle(bj) || bj.includes('*')) return ai === bj && go(i + 1, j + 1);
			return picomatch.isMatch(bj, ai) && go(i + 1, j + 1);
		}

		// A literal covers only itself.
		return ai === bj && go(i + 1, j + 1);
	};

	return go(0, 0);
}

/** Deep-subset comparison: every key/index present in `expected` must match `actual`. */
export function isSubset(expected: unknown, actual: unknown): boolean {
	if (expected === null || typeof expected !== 'object') return expected === actual;
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return false;
		return expected.every((e, i) => isSubset(e, actual[i]));
	}
	if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
	const a = actual as Record<string, unknown>;
	return Object.entries(expected as Record<string, unknown>).every(
		([k, v]) => k in a && isSubset(v, a[k]),
	);
}

/** Does this route's match spec accept the request? */
export function matchRoute(route: Route, req: MockRequest): boolean {
	const m = route.match;
	if (m.method !== '*' && m.method !== req.method) return false;
	if (matchPath(m.path, req.path) === null) return false;
	if (m.query && !Object.entries(m.query).every(([k, v]) => req.query[k] === v)) return false;
	if (m.bodyMatch !== undefined && !isSubset(m.bodyMatch, req.body)) return false;
	return true;
}
