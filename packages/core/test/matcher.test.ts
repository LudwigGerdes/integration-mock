import { describe, it, expect } from 'vitest';
import { matchPath, matchRoute, pathSubsumes } from '../src/matcher.js';
import type { Route, MockRequest } from '../src/types.js';

const req = (o: Partial<MockRequest>): MockRequest => ({
	method: 'GET',
	host: 'x',
	path: '/',
	query: {},
	headers: {},
	...o,
});

describe('matchPath', () => {
	it('exact', () => expect(matchPath('/a/b', '/a/b')).toEqual({}));
	it('mismatch', () => expect(matchPath('/a/b', '/a/c')).toBeNull());
	it(':param captures', () => expect(matchPath('/users/:id', '/users/42')).toEqual({ id: '42' }));
	it('* one segment', () => {
		expect(matchPath('/v1/*/items', '/v1/abc/items')).toEqual({});
		expect(matchPath('/v1/*/items', '/v1/a/b/items')).toBeNull();
	});
	it('** many segments incl. zero', () => {
		expect(matchPath('/api/**', '/api')).toEqual({});
		expect(matchPath('/api/**', '/api/a/b/c')).toEqual({});
		expect(matchPath('/api/**/end', '/api/a/b/end')).toEqual({});
	});
	it('in-segment glob', () =>
		expect(
			matchPath('/v4/spreadsheets/:id/values/*:append', '/v4/spreadsheets/abc/values/Sheet1!A1:append'),
		).toEqual({ id: 'abc' }));
	it('ignores trailing slash', () => expect(matchPath('/a/', '/a')).toEqual({}));
});

describe('matchRoute', () => {
	const base: Route = { id: 'r', match: { method: 'POST', path: '/api/chat.postMessage' } };
	it('method + path', () => {
		expect(matchRoute(base, req({ method: 'POST', path: '/api/chat.postMessage' }))).toBe(true);
		expect(matchRoute(base, req({ method: 'GET', path: '/api/chat.postMessage' }))).toBe(false);
	});
	it('method wildcard', () =>
		expect(
			matchRoute({ ...base, match: { method: '*', path: '/x' } }, req({ method: 'DELETE', path: '/x' })),
		).toBe(true));
	it('query subset must equal', () => {
		const r: Route = { ...base, match: { method: 'GET', path: '/s', query: { page: '2' } } };
		expect(matchRoute(r, req({ path: '/s', query: { page: '2', extra: '1' } }))).toBe(true);
		expect(matchRoute(r, req({ path: '/s', query: { page: '3' } }))).toBe(false);
		expect(matchRoute(r, req({ path: '/s' }))).toBe(false);
	});
	it('bodyMatch deep subset, arrays by index', () => {
		const r: Route = {
			...base,
			match: { method: 'POST', path: '/b', bodyMatch: { a: { b: 1 }, list: [{ id: 1 }] } },
		};
		expect(
			matchRoute(
				r,
				req({
					method: 'POST',
					path: '/b',
					body: { a: { b: 1, c: 2 }, list: [{ id: 1, n: 'x' }, { id: 2 }] },
				}),
			),
		).toBe(true);
		expect(
			matchRoute(r, req({ method: 'POST', path: '/b', body: { a: { b: 2 }, list: [{ id: 1 }] } })),
		).toBe(false);
		expect(matchRoute(r, req({ method: 'POST', path: '/b' }))).toBe(false);
	});
});

describe('pathSubsumes', () => {
	const yes = (a: string, b: string): void => expect(pathSubsumes(a, b)).toBe(true);
	const no = (a: string, b: string): void => expect(pathSubsumes(a, b)).toBe(false);

	it('a capture swallows a literal in the same position', () => {
		// The Salesforce case: /sobjects/Opportunity/:id above .../describe means
		// describe can never serve.
		yes('/sobjects/Opportunity/:id', '/sobjects/Opportunity/describe');
		yes('/things/*', '/things/describe');
	});

	it('a literal does not swallow a capture', () => {
		no('/sobjects/Opportunity/describe', '/sobjects/Opportunity/:id');
	});

	it('identical patterns subsume each other', () => {
		yes('/a/b', '/a/b');
		yes('/a/:x', '/a/:y');
	});

	it('different literals do not', () => {
		no('/a/b', '/a/c');
	});

	it('** swallows any number of segments', () => {
		yes('/a/**', '/a/b/c');
		yes('/**', '/anything/at/all');
		no('/a/:x', '/a/b/c');
	});

	it('a narrower pattern never swallows a broader one', () => {
		no('/a/b/c', '/a/**');
		no('/a/:x', '/a/**');
	});

	it('a glob swallows literals it matches, and nothing it does not', () => {
		yes('/v*', '/v58');
		no('/v*', '/x58');
	});

	it('length mismatches do not subsume', () => {
		no('/a/:x', '/a');
		no('/a', '/a/b');
	});
});
