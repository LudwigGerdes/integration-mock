import { describe, it, expect } from 'vitest';
import { validatePack } from '../src/pack-validate.js';
import type { ServicePack } from '../src/types.js';

const base: ServicePack = {
	id: 'acme',
	domains: ['api.acme.test'],
	prefix: '/acme',
	source: 'authored',
	routes: [
		{
			id: 'get-thing',
			match: { method: 'GET', path: '/things/1' },
			respond: { status: 200, body: { id: 1 } },
		},
		{ id: 'err', match: { method: 'GET', path: '/boom' }, respond: { status: 500, body: { error: 'x' } } },
	],
};
const codes = (p: unknown, others?: ServicePack[]): string[] =>
	validatePack(p, { others }).map((x) => x.code);

describe('provenance', () => {
	it('is accepted when present and when absent', () => {
		expect(codes(base)).toEqual([]);
		expect(
			codes({
				...base,
				source: 'recorded',
				provenance: { recordedAt: '2026-09-25T00:00:00.000Z', tool: { name: 'integration-mock', version: '0.1.1' }, redacted: true },
			}),
		).toEqual([]);
	});
	it('rejects a provenance block with unknown keys', () => {
		expect(codes({ ...base, provenance: { apiKey: 'x' } }).length).toBeGreaterThan(0);
	});
});

describe('validatePack', () => {
	it('passes a well-formed pack with no problems', () => {
		expect(validatePack(base)).toEqual([]);
	});

	it('reports a structural violation from the schema', () => {
		expect(codes({ ...base, prefix: 'acme' })).toContain('schema');
	});

	it('catches duplicate route ids', () => {
		const dup = { ...base, routes: [...base.routes, { ...base.routes[0]! }] };
		expect(codes(dup)).toContain('duplicate-route-id');
	});

	it('catches a shadowed route, which would silently never serve', () => {
		const shadowed = {
			...base,
			routes: [
				...base.routes,
				{ id: 'other', match: { method: 'GET' as const, path: '/things/1' }, respond: { status: 201 } },
			],
		};
		expect(codes(shadowed)).toContain('shadowed-route');
	});

	it('catches a prefix or domain colliding with another installed pack', () => {
		const other: ServicePack = { ...base, id: 'other' };
		expect(codes(base, [other])).toEqual(
			expect.arrayContaining(['prefix-collision', 'domain-collision']),
		);
	});

	it('warns when a pack can only succeed', () => {
		const happy = { ...base, routes: [base.routes[0]!] };
		expect(codes(happy)).toContain('no-error-routes');
	});

	it('warns about a route that neither responds nor handles', () => {
		const inert = { ...base, routes: [{ id: 'x', match: { method: 'GET' as const, path: '/x' } }] };
		expect(codes(inert)).toContain('inert-route');
	});

	it('separates errors from warnings', () => {
		const problems = validatePack({ ...base, routes: [base.routes[0]!] });
		expect(problems.every((p) => p.level === 'warning')).toBe(true);
	});
});

describe('shadowing through the pattern grammar', () => {
	const pack = (routes: ServicePack['routes']): ServicePack => ({
		id: 'sf',
		domains: ['api.sf.test'],
		prefix: '/sf',
		source: 'authored',
		routes,
	});
	const describeRoute = {
		id: 'describe',
		match: { method: 'GET' as const, path: '/sobjects/Opportunity/describe' },
		respond: { status: 200 },
	};
	const byId = {
		id: 'get-by-id',
		match: { method: 'GET' as const, path: '/sobjects/Opportunity/:id' },
		respond: { status: 200 },
	};

	it('flags a literal route placed below a capture that swallows it', () => {
		const problems = validatePack(pack([byId, describeRoute]));
		expect(problems.map((p) => p.code)).toContain('shadowed-route');
		expect(problems.find((p) => p.code === 'shadowed-route')?.route).toBe('describe');
	});

	it('accepts the correct order', () => {
		expect(validatePack(pack([describeRoute, byId])).map((p) => p.code)).not.toContain(
			'shadowed-route',
		);
	});

	it('does not flag routes that differ by method', () => {
		const patch = { ...byId, id: 'patch', match: { ...byId.match, method: 'PATCH' as const } };
		expect(validatePack(pack([byId, patch])).map((p) => p.code)).not.toContain('shadowed-route');
	});

	it('flags a general query route placed above a specific one', () => {
		const general = { id: 'q', match: { method: 'GET' as const, path: '/query' }, respond: { status: 200 } };
		const specific = {
			id: 'q-bad',
			match: { method: 'GET' as const, path: '/query', query: { q: 'INVALID' } },
			respond: { status: 400 },
		};
		expect(validatePack(pack([general, specific])).map((p) => p.code)).toContain('shadowed-route');
		expect(validatePack(pack([specific, general])).map((p) => p.code)).not.toContain('shadowed-route');
	});
});

describe('store routes in the schema', () => {
	const storeRoute = {
		id: 'things:create',
		match: { method: 'POST', path: '/things' },
		store: {
			op: 'create',
			collection: 'things',
			id: { field: 'id', format: 't_{{seq:3}}' },
			stamp: { object: 'thing' },
			idempotency: { header: 'Idempotency-Key' },
		},
		respond: { status: 201, template: true, body: '{{record}}' },
	};
	const listRoute = {
		id: 'things:list',
		match: { method: 'GET', path: '/things' },
		store: {
			op: 'list',
			collection: 'things',
			filters: [{ from: 'query.email', field: 'email' }, { from: 'body.filterGroups', style: 'hubspot' }],
			pagination: { style: 'cursor', cursorParam: 'after', limitParam: 'limit', defaultLimit: 10, maxLimit: 100 },
		},
		respond: { status: 200, template: true, body: { data: '{{records}}' } },
	};

	it('accepts a create and a list route', () => {
		expect(codes({ ...base, routes: [...base.routes, storeRoute, listRoute] })).toEqual([]);
	});

	it('rejects an unknown op, pagination style or filter style', () => {
		expect(codes({ ...base, routes: [{ ...storeRoute, store: { op: 'upsert', collection: 'things' } }] })).toContain('schema');
		expect(
			codes({ ...base, routes: [{ ...listRoute, store: { ...listRoute.store, pagination: { style: 'keyset' } } }] }),
		).toContain('schema');
		expect(
			codes({ ...base, routes: [{ ...listRoute, store: { ...listRoute.store, filters: [{ from: 'query.q', style: 'graphql' }] } }] }),
		).toContain('schema');
	});

	it('accepts a store block on a sequence entry', () => {
		const seq = {
			id: 'things:once',
			match: { method: 'POST', path: '/once' },
			sequence: [
				{ status: 201, template: true, body: '{{record}}', store: { op: 'create', collection: 'things' } },
				{ status: 409, body: { error: 'exists' } },
			],
		};
		expect(codes({ ...base, routes: [...base.routes, seq] })).toEqual([]);
	});
});

describe('store route semantics', () => {
	const r = (id: string, path: string, method: string, store: unknown, extra: Record<string, unknown> = {}) => ({
		id,
		match: { method, path },
		store,
		respond: { status: 200, template: true, body: '{{record}}' },
		...extra,
	});
	const pack = (routes: unknown[], seed?: Record<string, unknown[]>) => ({ ...base, routes: [...base.routes, ...routes], ...(seed ? { seed } : {}) });

	it('needs a respond to render', () => {
		const route = { id: 's', match: { method: 'POST', path: '/s' }, store: { op: 'create', collection: 'c' } };
		expect(codes(pack([route]))).toContain('store-respond');
	});

	it('needs a collection, except a SOQL list or a nextUrl follow-up', () => {
		expect(codes(pack([r('a', '/a', 'POST', { op: 'create' })]))).toContain('store-collection');
		expect(codes(pack([r('q', '/q', 'GET', { op: 'list', filters: [{ from: 'query.q', style: 'soql' }] })]))).toEqual([]);
		expect(codes(pack([r('n', '/q/:token', 'GET', { op: 'list', pagination: { style: 'nextUrl', tokenParam: 'token' } })]))).toEqual([]);
	});

	it('needs idParam when the path has more than one param, and it must be a param', () => {
		expect(codes(pack([r('g', '/v/:version/things/:id', 'GET', { op: 'get', collection: 'c' })]))).toContain('store-id-param');
		expect(codes(pack([r('g', '/v/:version/things/:id', 'GET', { op: 'get', collection: 'c', idParam: 'id' })]))).toEqual([]);
		expect(codes(pack([r('g', '/things/:id', 'GET', { op: 'get', collection: 'c', idParam: 'thing' })]))).toContain('store-id-param');
	});

	it('allows idempotency only on create and update', () => {
		expect(codes(pack([r('l', '/l', 'GET', { op: 'list', collection: 'c', idempotency: { header: 'Idempotency-Key' } })]))).toContain('store-idempotency');
	});

	it('needs a nextUrl route to issue or follow tokens', () => {
		expect(codes(pack([r('q', '/q', 'GET', { op: 'list', collection: 'c', pagination: { style: 'nextUrl' } })]))).toContain('store-next-url');
	});

	it('warns about an unpaged list over a large seed', () => {
		const seed = { c: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) };
		expect(codes(pack([r('l', '/l', 'GET', { op: 'list', collection: 'c' })], seed))).toContain('unpaged-list');
	});
});

describe('review fixes: validation', () => {
	it('a route-level store beside a sequence without respond is an error', () => {
		const route = {
			id: 's',
			match: { method: 'POST', path: '/s' },
			store: { op: 'create', collection: 'c' },
			sequence: [{ status: 201, template: true, body: '{{record}}' }],
		};
		expect(codes({ ...base, routes: [...base.routes, route] })).toContain('store-respond');
	});
});
