import { describe, it, expect } from 'vitest';
import { resolve, type LayeredPacks } from '../src/layers.js';
import { ResourceStore } from '../src/store.js';
import { idSpecsFor } from '../src/store-op.js';
import type { MockRequest, Resolution, ServicePack } from '../src/types.js';

const acme: ServicePack = {
	id: 'acme',
	domains: ['acme.test'],
	prefix: '/acme',
	source: 'authored',
	routes: [
		{
			id: 'create',
			match: { method: 'POST', path: '/things' },
			store: {
				op: 'create',
				collection: 'things',
				id: { field: 'id', format: 't_{{seq:3}}' },
				stamp: { object: 'thing', url: '/things/{{record.id}}' },
				idempotency: { header: 'Idempotency-Key' },
			},
			respond: { status: 201, template: true, body: '{{record}}' },
		},
		{
			id: 'get',
			match: { method: 'GET', path: '/things/:id' },
			store: { op: 'get', collection: 'things', notFound: { status: 404, template: true, body: { message: 'no thing {{request.params.id}}' } } },
			respond: { status: 200, template: true, body: '{{record}}' },
		},
		{
			id: 'update',
			match: { method: 'PATCH', path: '/things/:id' },
			store: { op: 'update', collection: 'things' },
			respond: { status: 200, template: true, body: '{{record}}' },
		},
		{
			id: 'delete',
			match: { method: 'DELETE', path: '/things/:id' },
			store: { op: 'delete', collection: 'things' },
			respond: { status: 204 },
		},
		{
			id: 'list',
			match: { method: 'GET', path: '/things' },
			store: {
				op: 'list',
				collection: 'things',
				filters: [{ from: 'query.color', field: 'color' }],
				pagination: { style: 'cursor', cursorParam: 'after', limitParam: 'limit', defaultLimit: 2 },
			},
			respond: { status: 200, template: true, body: { data: '{{records}}', next: '{{page.next}}', total: '{{page.total}}' } },
		},
		{
			id: 'query',
			match: { method: 'GET', path: '/query' },
			store: { op: 'list', filters: [{ from: 'query.q', style: 'soql' }] },
			respond: { status: 200, template: true, body: { records: '{{records}}' } },
		},
		{
			id: 'once',
			match: { method: 'POST', path: '/once' },
			sequence: [
				{ status: 201, template: true, body: '{{record}}', store: { op: 'create', collection: 'things' } },
				{ status: 409, body: { error: 'already done' } },
			],
		},
	],
};

const harness = () => {
	const packs: LayeredPacks = { library: [acme], user: [], project: [], snapshot: [] };
	const store = new ResourceStore({}, idSpecsFor([acme]));
	const counters = new Map<string, number>();
	return (o: Partial<MockRequest>): Resolution =>
		resolve(packs, 'acme', { method: 'GET', host: 'acme.test', path: '/', query: {}, headers: {}, ...o }, store, counters);
};

describe('store routes through resolve()', () => {
	it('create → get → update → delete → 404, with stamp and minted ids', () => {
		const call = harness();
		const created = call({ method: 'POST', path: '/things', body: { name: 'a', color: 'red' } });
		expect(created).toMatchObject({ status: 201, body: { id: 't_001', name: 'a', object: 'thing', url: '/things/t_001' }, matched: { routeId: 'create' } });
		expect(call({ path: '/things/t_001' }).body).toMatchObject({ id: 't_001', name: 'a' });
		expect(call({ method: 'PATCH', path: '/things/t_001', body: { id: 'hijack', name: 'b' } }).body).toMatchObject({ id: 't_001', name: 'b', color: 'red' });
		expect(call({ method: 'DELETE', path: '/things/t_001' }).status).toBe(204);
		expect(call({ path: '/things/t_001' })).toMatchObject({ status: 404, body: { message: 'no thing t_001' } });
	});

	it('lists with a filter and cursor paging', () => {
		const call = harness();
		for (const color of ['red', 'blue', 'red', 'red']) call({ method: 'POST', path: '/things', body: { color } });
		const p1 = call({ path: '/things', query: { color: 'red' } }).body as { data: Array<{ id: string }>; next: string; total: number };
		expect(p1.data.map((t) => t.id)).toEqual(['t_001', 't_003']);
		expect(p1).toMatchObject({ next: 't_003', total: 3 });
		const p2 = call({ path: '/things', query: { color: 'red', after: 't_003' } }).body as { data: Array<{ id: string }>; next: string };
		expect(p2.data.map((t) => t.id)).toEqual(['t_004']);
		expect(p2.next).toBe('');
	});

	it('a bad paging param or SOQL answers 400 with the reason', () => {
		const call = harness();
		expect(call({ path: '/things', query: { limit: '0' } })).toMatchObject({ status: 400, body: { error: 'invalid limit' } });
		expect(call({ path: '/query', query: { q: 'SELECT Id FROM things WHERE a = 1 OR b = 2' } })).toMatchObject({
			status: 400,
			body: { error: 'OR in SOQL is not supported by integration-mock' },
		});
	});

	it('SOQL in lower case resolves the collection case-insensitively', () => {
		const call = harness();
		call({ method: 'POST', path: '/things', body: { color: 'red' } });
		expect(call({ path: '/query', query: { q: "select id from THINGS where color = 'red'" } }).body).toEqual({ records: [{ id: 't_001' }] });
	});

	it('a body that is not an object is refused, not stored as an empty record', () => {
		const call = harness();
		expect(call({ method: 'POST', path: '/things', body: ['not', 'an', 'object'] })).toMatchObject({
			status: 400,
			body: { error: 'expected a JSON object body' },
		});
		expect((call({ path: '/things' }).body as { total: number }).total).toBe(0);
	});

	it('idempotency: same key and body replays; a different body conflicts', () => {
		const call = harness();
		const headers = { 'idempotency-key': 'k1' };
		const first = call({ method: 'POST', path: '/things', headers, body: { name: 'a' } });
		const again = call({ method: 'POST', path: '/things', headers, body: { name: 'a' } });
		expect(again.body).toEqual(first.body);
		expect((call({ path: '/things' }).body as { total: number }).total).toBe(1);
		expect(call({ method: 'POST', path: '/things', headers, body: { name: 'b' } })).toMatchObject({
			status: 409,
			body: { error: 'idempotency key reused with different parameters' },
		});
	});

	it('a sequence entry can carry its own store op', () => {
		const call = harness();
		expect(call({ method: 'POST', path: '/once', body: { name: 'x' } }).status).toBe(201);
		expect(call({ method: 'POST', path: '/once', body: { name: 'y' } })).toMatchObject({ status: 409, body: { error: 'already done' } });
		expect((call({ path: '/things' }).body as { total: number }).total).toBe(1);
	});

	it('form-encoded bodies are parsed with brackets', () => {
		const call = harness();
		const res = call({
			method: 'POST',
			path: '/things',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'name=a&metadata[plan]=pro',
		});
		expect(res.body).toMatchObject({ name: 'a', metadata: { plan: 'pro' } });
	});
});

describe('idSpecsFor', () => {
	it('collects the first id spec per collection from routes and sequence entries', () => {
		expect(idSpecsFor([acme])).toEqual({ things: { field: 'id', format: 't_{{seq:3}}' } });
	});
});
