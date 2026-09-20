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
