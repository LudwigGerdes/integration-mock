import { describe, it, expect } from 'vitest';
import { compareRoute, isSafe } from '../src/verify.js';
import type { Route } from '../src/types.js';

const route = (over: Partial<Route> = {}): Route => ({
	id: 'get-opp',
	match: { method: 'GET', path: '/sobjects/Opportunity/:id' },
	respond: { status: 200, body: { Id: 'mock', Name: 'Mock Co' } },
	...over,
});

describe('isSafe', () => {
	it('admits only read methods', () => {
		expect(isSafe(route())).toBe(true);
		expect(isSafe(route({ match: { method: 'HEAD', path: '/x' } }))).toBe(true);
		expect(isSafe(route({ match: { method: 'POST', path: '/x' } }))).toBe(false);
		expect(isSafe(route({ match: { method: 'DELETE', path: '/x' } }))).toBe(false);
	});

	it('treats a wildcard method as unsafe, since it includes writes', () => {
		expect(isSafe(route({ match: { method: '*', path: '/x' } }))).toBe(false);
	});
});

describe('compareRoute', () => {
	it('finds nothing when status and shape agree', () => {
		expect(
			compareRoute(route(), { status: 200, body: { Id: 'real-id', Name: 'Real Co' } }),
		).toEqual([]);
	});

	it('reports a status disagreement', () => {
		const f = compareRoute(route(), { status: 404, body: {} });
		expect(f.map((x) => x.kind)).toContain('status');
		expect(f[0]?.message).toMatch(/200.*404/);
	});

	it('reports shape differences and carries the diffs', () => {
		const f = compareRoute(route(), { status: 200, body: { Id: 'real' } });
		const shape = f.find((x) => x.kind === 'shape');
		expect(shape?.diffs).toEqual([{ kind: 'invented', path: 'Name', mock: 'string' }]);
	});

	it('reports an unreachable vendor rather than pretending it matched', () => {
		const f = compareRoute(route(), { error: 'getaddrinfo ENOTFOUND' });
		expect(f[0]?.kind).toBe('unreachable');
		expect(f[0]?.message).toMatch(/ENOTFOUND/);
	});

	it('skips a route with nothing to compare', () => {
		const f = compareRoute(route({ respond: undefined, handler: 'x' }), { status: 200, body: {} });
		expect(f[0]?.kind).toBe('skipped');
	});

	it('does not compare shape when the status already disagrees', () => {
		// An error body has a different shape by nature; reporting both would
		// bury the finding that actually matters.
		const f = compareRoute(route(), { status: 500, body: [{ message: 'boom' }] });
		expect(f.map((x) => x.kind)).toEqual(['status']);
	});
});

describe('store routes', () => {
	const stored = route({ store: { op: 'get', collection: 'Opportunity' }, respond: { status: 200, template: true, body: '{{record}}' } });

	it('skips the body, saying why, when the status agrees', () => {
		expect(compareRoute(stored, { status: 200, body: { Id: 'real', Extra: 1 } })).toEqual([
			{ route: 'get-opp', kind: 'skipped', message: 'store route: the body is computed from stored records, so only the status is compared' },
		]);
	});

	it('still reports a status difference', () => {
		expect(compareRoute(stored, { status: 404, body: {} })[0]?.kind).toBe('status');
	});
});
