import { describe, it, expect } from 'vitest';
import { followToken, PageTokens, paginate, sortRows, type PageContext } from '../src/paginate.js';
import type { Row } from '../src/filter.js';

const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: `r${String(i + 1).padStart(2, '0')}`, n: 25 - i }));
const ctx = (q: Record<string, string> = {}): PageContext => ({
	read: (name) => q[name],
	idField: 'id',
	tokens: new PageTokens(),
	nextUrl: (token) => `/next/${token}`,
	collection: 'things',
});
const ids = (r: { ok: boolean; rows?: Row[] }) => (r.ok ? r.rows!.map((x) => x['id']) : []);

describe('paginate', () => {
	it('without a spec returns everything with the total', () => {
		expect(paginate(rows, undefined, ctx())).toMatchObject({ ok: true, page: { total: 25, hasMore: false } });
	});

	it('cursor: walks three pages, the cursor being the last id served', () => {
		const spec = { style: 'cursor' as const, cursorParam: 'after', limitParam: 'limit', defaultLimit: 10 };
		const p1 = paginate(rows, spec, ctx());
		expect(p1).toMatchObject({ ok: true, page: { next: 'r10', hasMore: true, total: 25 } });
		const p2 = paginate(rows, spec, ctx({ after: 'r10' }));
		expect(ids(p2)[0]).toBe('r11');
		const p3 = paginate(rows, spec, ctx({ after: 'r20' }));
		expect(ids(p3)).toEqual(['r21', 'r22', 'r23', 'r24', 'r25']);
		expect(p3).toMatchObject({ page: { next: '', hasMore: false } });
	});

	it('cursor naming a record that is gone is an error, not page one', () => {
		expect(paginate(rows, { style: 'cursor', cursorParam: 'after' }, ctx({ after: 'deleted' }))).toEqual({ ok: false, error: 'invalid cursor' });
	});

	it('offset and page styles report next positions', () => {
		expect(paginate(rows, { style: 'offset', offsetParam: 'offset', limitParam: 'limit' }, ctx({ offset: '20', limit: '10' }))).toMatchObject({
			page: { offset: 20, nextOffset: null, hasMore: false, total: 25 },
		});
		const p = paginate(rows, { style: 'page', pageParam: 'page', limitParam: 'per_page' }, ctx({ page: '2', per_page: '10' }));
		expect(ids(p)[0]).toBe('r11');
		expect(p).toMatchObject({ page: { number: 2, nextNumber: 3, totalPages: 3, hasMore: true } });
	});

	it.each([
		[{ limit: '0' }, 'invalid limit'],
		[{ limit: '-5' }, 'invalid limit'],
		[{ limit: 'ten' }, 'invalid limit'],
	])('rejects %j', (q, error) => {
		expect(paginate(rows, { style: 'cursor', cursorParam: 'after', limitParam: 'limit' }, ctx(q))).toEqual({ ok: false, error });
	});

	it('rejects a page below 1 and a negative offset', () => {
		expect(paginate(rows, { style: 'page', pageParam: 'page' }, ctx({ page: '0' }))).toEqual({ ok: false, error: 'invalid page' });
		expect(paginate(rows, { style: 'offset', offsetParam: 'offset' }, ctx({ offset: '-1' }))).toEqual({ ok: false, error: 'invalid offset' });
	});

	it('caps the limit at maxLimit', () => {
		expect(ids(paginate(rows, { style: 'cursor', cursorParam: 'after', limitParam: 'limit', maxLimit: 3 }, ctx({ limit: '100' })))).toHaveLength(3);
	});

	it('nextUrl: issues a token for the rest and follows it to the end', () => {
		const c = ctx();
		const first = paginate(rows, { style: 'nextUrl', defaultLimit: 10 }, c);
		expect(first).toMatchObject({ ok: true, page: { done: false, total: 25 } });
		const url = first.ok ? String(first.page['nextUrl']) : '';
		const token = c.tokens.get(url.replace('/next/', ''))!;
		const byId = new Map(rows.map((r) => [String(r['id']), r]));
		const second = followToken(token, (id) => byId.get(id), c);
		expect(second.rows[0]?.['id']).toBe('r11');
		const third = followToken(c.tokens.get(String(second.page['nextUrl']).replace('/next/', ''))!, (id) => byId.get(id), c);
		expect(third.rows).toHaveLength(5);
		expect(third.page).toMatchObject({ nextUrl: '', done: true });
	});

	it('nextUrl: records deleted since the token was issued are skipped', () => {
		const c = ctx();
		const first = paginate(rows.slice(0, 4), { style: 'nextUrl', defaultLimit: 2 }, c);
		const token = c.tokens.get(String(first.ok && first.page['nextUrl']).replace('/next/', ''))!;
		expect(followToken(token, (id) => (id === 'r03' ? undefined : { id }), c).rows).toEqual([{ id: 'r04' }]);
	});
});

describe('sortRows', () => {
	it('sorts stably by a field', () => {
		expect(sortRows(rows.slice(0, 3), { field: 'n' }).map((r) => r['id'])).toEqual(['r03', 'r02', 'r01']);
		expect(sortRows(rows.slice(0, 3), undefined)).toEqual(rows.slice(0, 3));
	});
});
