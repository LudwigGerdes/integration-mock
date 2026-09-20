export type Matcher = 'equals' | 'contains' | 'matches' | 'count' | 'gte' | 'lte';

export interface AssertionRow {
	actual: unknown;
	path: string;
	matcher?: Matcher;
	expected: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v);

/** `a.b`, `a[0]`, `a[*]`, `a.*` — split into one step per segment. */
function tokenize(path: string): string[] {
	const tokens: string[] = [];
	for (const part of path.split('.')) {
		if (part === '') continue;
		const head = part.replace(/\[.*$/, '');
		if (head !== '') tokens.push(head);
		for (const m of part.matchAll(/\[([^\]]*)\]/g)) tokens.push(`[${m[1]!}]`);
	}
	return tokens;
}

/**
 * Every value a path selects.
 *
 * A glob can select many, a miss selects none — so callers distinguish "matched
 * nothing" from "matched a falsy value", which a single-value API cannot.
 */
export function selectPath(value: unknown, path: string): unknown[] {
	let current: unknown[] = [value];
	for (const token of tokenize(path)) {
		const next: unknown[] = [];
		const index = token.startsWith('[') ? token.slice(1, -1) : null;
		for (const v of current) {
			if (index !== null) {
				if (!Array.isArray(v)) continue;
				if (index === '*') next.push(...v);
				else {
					const i = Number(index);
					if (Number.isInteger(i) && i >= 0 && i < v.length) next.push(v[i]);
				}
				continue;
			}
			if (token === '*') {
				if (Array.isArray(v)) next.push(...v);
				else if (isObj(v)) next.push(...Object.values(v));
				continue;
			}
			if (isObj(v) && token in v) next.push(v[token]);
		}
		current = next;
	}
	return current;
}

const deepEquals = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Substring for strings, membership for arrays, deep subset for objects. */
function containsValue(actual: unknown, expected: unknown): boolean {
	if (typeof actual === 'string') return actual.includes(String(expected));
	if (Array.isArray(actual)) return actual.some((v) => deepEquals(v, expected));
	if (isObj(actual) && isObj(expected)) {
		return Object.entries(expected).every(([k, v]) =>
			isObj(v) && isObj(actual[k]) ? containsValue(actual[k], v) : deepEquals(actual[k], v),
		);
	}
	return deepEquals(actual, expected);
}

function satisfies(matcher: Matcher, actual: unknown, expected: unknown): boolean {
	switch (matcher) {
		case 'contains':
			return containsValue(actual, expected);
		case 'matches':
			return typeof actual === 'string' && new RegExp(String(expected)).test(actual);
		case 'gte':
			return typeof actual === 'number' && actual >= Number(expected);
		case 'lte':
			return typeof actual === 'number' && actual <= Number(expected);
		default:
			return deepEquals(actual, expected);
	}
}

/**
 * Evaluate one assertion (suite seam S3).
 *
 * `count` compares how many values the path selected. Every other matcher must
 * hold for *all* selected values and requires at least one — so a path that
 * matches nothing fails rather than passing vacuously, which is the reading that
 * catches a renamed node instead of quietly going green.
 */
export function evaluateAssertion(row: AssertionRow): boolean {
	const selected = selectPath(row.actual, row.path);
	const matcher = row.matcher ?? 'equals';
	if (matcher === 'count') return selected.length === Number(row.expected);
	if (selected.length === 0) return false;
	return selected.every((v) => satisfies(matcher, v, row.expected));
}
