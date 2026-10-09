import type { FilterOp, FilterSpec, MockRequest } from './types.js';

export type Row = Record<string, unknown>;
export type FilterOutcome = { ok: true; rows: Row[] } | { ok: false; error: string };

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Dotted path lookup; `[n]` indexes arrays. Inherited keys are never read. */
export function getPath(value: unknown, path: string): unknown {
	let cur = value;
	for (const part of path.split('.').flatMap((p) => p.split(/\[(\d+)\]/).filter((s) => s !== ''))) {
		if (cur === null || typeof cur !== 'object' || !own(cur, part)) return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

const asNumber = (v: unknown): number | undefined => {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
	return undefined;
};

/** Order two values: numerically when both are numbers, else as strings; missing values last. */
export function compareValues(a: unknown, b: unknown): number {
	const missingA = a === undefined || a === null;
	const missingB = b === undefined || b === null;
	if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
	const na = asNumber(a);
	const nb = asNumber(b);
	if (na !== undefined && nb !== undefined) return na - nb;
	const sa = String(a);
	const sb = String(b);
	return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** One comparison. Null means "has no value": `eq null` matches a missing field. */
export function compare(op: FilterOp, actual: unknown, expected: unknown): boolean {
	const missing = actual === undefined || actual === null;
	if (expected === null) return op === 'eq' ? missing : op === 'ne' ? !missing : false;
	switch (op) {
		case 'eq':
			return !missing && compareValues(actual, expected) === 0;
		case 'ne':
			return missing || compareValues(actual, expected) !== 0;
		case 'gt':
			return !missing && compareValues(actual, expected) > 0;
		case 'gte':
			return !missing && compareValues(actual, expected) >= 0;
		case 'lt':
			return !missing && compareValues(actual, expected) < 0;
		case 'lte':
			return !missing && compareValues(actual, expected) <= 0;
		case 'contains':
			return Array.isArray(actual)
				? actual.some((x) => String(x) === String(expected))
				: !missing && String(actual).includes(String(expected));
		case 'in':
			return String(expected)
				.split(',')
				.map((v) => v.trim())
				.some((v) => compare('eq', actual, v));
	}
}

/** What a filter's `from` names: `query.<name>`, `body.<path>` or `params.<name>`. */
export function readInput(from: string, req: MockRequest, body: unknown, params: Record<string, string>): unknown {
	const dot = from.indexOf('.');
	const where = from.slice(0, dot);
	const name = from.slice(dot + 1);
	if (where === 'query') return req.query[name];
	if (where === 'params') return params[name];
	if (where === 'body') return getPath(body, name);
	return undefined;
}

const HUBSPOT_OPS: Record<string, FilterOp> = {
	EQ: 'eq',
	NEQ: 'ne',
	GT: 'gt',
	GTE: 'gte',
	LT: 'lt',
	LTE: 'lte',
	CONTAINS_TOKEN: 'contains',
};

interface Condition {
	field: string;
	op: FilterOp;
	value: unknown;
}

/** HubSpot `filterGroups`: OR between groups, AND within one; properties live under `properties`. */
function hubspot(rows: Row[], groups: unknown): FilterOutcome {
	if (!Array.isArray(groups) || groups.length === 0) return { ok: true, rows };
	const parsed: Condition[][] = [];
	for (const group of groups) {
		const filters: unknown = group !== null && typeof group === 'object' ? (group as { filters?: unknown }).filters : undefined;
		if (!Array.isArray(filters)) return { ok: false, error: 'HubSpot filterGroups[] needs a filters list' };
		const conditions: Condition[] = [];
		for (const f of filters) {
			const { propertyName, operator, value } = (f ?? {}) as { propertyName?: unknown; operator?: unknown; value?: unknown };
			const op = typeof operator === 'string' ? HUBSPOT_OPS[operator] : undefined;
			if (op === undefined) return { ok: false, error: `HubSpot operator ${String(operator)} is not supported by integration-mock` };
			if (typeof propertyName !== 'string') return { ok: false, error: 'HubSpot filter needs a propertyName' };
			conditions.push({ field: `properties.${propertyName}`, op, value });
		}
		parsed.push(conditions);
	}
	return {
		ok: true,
		rows: rows.filter((row) => parsed.some((g) => g.every((c) => compare(c.op, getPath(row, c.field), c.value)))),
	};
}

/** Apply flat and `hubspot` filters in order. `soql` filters are applied by soql.ts and skipped here. */
export function applyFilters(
	rows: Row[],
	filters: FilterSpec[],
	req: MockRequest,
	body: unknown,
	params: Record<string, string>,
): FilterOutcome {
	let out = rows;
	for (const f of filters) {
		const input = readInput(f.from, req, body, params);
		if (input === undefined || input === '') continue;
		if ('style' in f) {
			if (f.style === 'soql') continue;
			const r = hubspot(out, input);
			if (!r.ok) return r;
			out = r.rows;
			continue;
		}
		const op = f.op ?? 'eq';
		out = out.filter((row) => compare(op, getPath(row, f.field), input));
	}
	return { ok: true, rows: out };
}
