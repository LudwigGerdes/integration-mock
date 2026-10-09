import { describe, it, expect } from 'vitest';
import { applyFilters, compare, compareValues, getPath, readInput, type Row } from '../src/filter.js';
import type { MockRequest } from '../src/types.js';

const req = (o: Partial<MockRequest> = {}): MockRequest => ({ method: 'GET', host: 'h', path: '/', query: {}, headers: {}, ...o });
const rows: Row[] = [
	{ id: 'a', email: 'ada@example.com', amount: '1500', tags: ['vip'], properties: { email: 'ada@example.com', lifecyclestage: 'lead' } },
	{ id: 'b', email: 'grace@example.com', amount: 300, tags: [], properties: { email: 'grace@example.com', lifecyclestage: 'customer' } },
	{ id: 'c', email: 'alan@example.com', amount: 20, properties: { email: 'alan@example.com', lifecyclestage: 'lead' } },
];

describe('getPath', () => {
	it('walks dotted paths and [n] indexes, and ignores inherited keys', () => {
		expect(getPath({ a: { b: [{ c: 1 }] } }, 'a.b[0].c')).toBe(1);
		expect(getPath({}, 'constructor')).toBeUndefined();
		expect(getPath(null, 'a')).toBeUndefined();
	});
});

describe('compare', () => {
	it('compares numerically when both sides are numbers, else as strings', () => {
		expect(compare('gt', '1500', 300)).toBe(true);
		expect(compare('gt', '9', '10')).toBe(false);
		expect(compare('lt', '2026-01-01', '2026-02-01')).toBe(true);
		expect(compare('eq', 300, '300')).toBe(true);
	});

	it('contains is substring for strings and membership for arrays; in splits on commas', () => {
		expect(compare('contains', 'ada@example.com', 'example')).toBe(true);
		expect(compare('contains', ['vip', 'beta'], 'vip')).toBe(true);
		expect(compare('in', 'b', 'a, b')).toBe(true);
	});

	it('treats null as "has no value"', () => {
		expect(compare('eq', undefined, null)).toBe(true);
		expect(compare('ne', 'x', null)).toBe(true);
		expect(compare('gt', undefined, 1)).toBe(false);
	});

	it('orders values: numbers numerically, missing values last', () => {
		expect([3, undefined, 1].sort(compareValues)).toEqual([1, 3, undefined]);
	});
});

describe('readInput', () => {
	it('reads query, body paths and params', () => {
		const r = req({ query: { email: 'x', 'created[gte]': '5' } });
		expect(readInput('query.email', r, undefined, {})).toBe('x');
		expect(readInput('query.created[gte]', r, undefined, {})).toBe('5');
		expect(readInput('body.a.b', r, { a: { b: 2 } }, {})).toBe(2);
		expect(readInput('params.type', r, undefined, { type: 'deals' })).toBe('deals');
	});
});

describe('applyFilters', () => {
	it('applies flat filters in order and skips absent inputs', () => {
		const out = applyFilters(rows, [{ from: 'query.email', field: 'email' }, { from: 'query.min', field: 'amount', op: 'gte' }], req({ query: { min: '100' } }), undefined, {});
		expect(out).toEqual({ ok: true, rows: [rows[0], rows[1]] });
	});

	it('HubSpot filterGroups: OR between groups, AND within, on properties.<name>', () => {
		const body = {
			filterGroups: [
				{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' }, { propertyName: 'email', operator: 'CONTAINS_TOKEN', value: 'alan' }] },
				{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] },
			],
		};
		const out = applyFilters(rows, [{ from: 'body.filterGroups', style: 'hubspot' }], req({ method: 'POST' }), body, {});
		expect(out.ok && out.rows.map((r) => r['id'])).toEqual(['b', 'c']);
	});

	it('HubSpot with no filterGroups returns every row', () => {
		expect(applyFilters(rows, [{ from: 'body.filterGroups', style: 'hubspot' }], req(), {}, {})).toEqual({ ok: true, rows });
	});

	it('an unsupported HubSpot operator is an error, not "everything"', () => {
		const body = { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'HAS_PROPERTY' }] }] };
		const out = applyFilters(rows, [{ from: 'body.filterGroups', style: 'hubspot' }], req(), body, {});
		expect(out).toEqual({ ok: false, error: 'HubSpot operator HAS_PROPERTY is not supported by integration-mock' });
	});

	it('leaves soql filters to soql.ts', () => {
		expect(applyFilters(rows, [{ from: 'query.q', style: 'soql' }], req({ query: { q: 'SELECT Id FROM X' } }), undefined, {})).toEqual({ ok: true, rows });
	});
});
