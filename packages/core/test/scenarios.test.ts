import { describe, it, expect } from 'vitest';
import { ScenarioController } from '../src/scenarios.js';
import type { MockRequest } from '../src/types.js';
import { scenarioResponse, scenarioShapes } from '../src/scenarios.js';
import type { ServicePack } from '../src/types.js';

const req = (method: MockRequest['method'] = 'GET', path = '/x'): MockRequest => ({
	method, host: 'h', path, query: {}, headers: {},
});
const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

describe('ScenarioController', () => {
	it('passes everything with nothing set', () => {
		expect(new ScenarioController().check('slack', req())).toBeNull();
	});

	it('answers an auth mode until cleared', () => {
		const s = new ScenarioController();
		s.setAuth('slack', 'revoked');
		expect(s.check('slack', req())).toEqual({ kind: 'auth', mode: 'revoked' });
		expect(s.check('hubspot', req())).toBeNull();
		s.clearAuth('slack');
		expect(s.check('slack', req())).toBeNull();
	});

	it('lets `calls` through per window, then limits with retryAfter, then rolls over', () => {
		const c = clock();
		const s = new ScenarioController(c.now);
		s.setLimit('hubspot', { calls: 2, perMs: 10_000 });
		expect(s.check('hubspot', req())).toBeNull();
		c.advance(2_500);
		expect(s.check('hubspot', req())).toBeNull();
		expect(s.check('hubspot', req())).toEqual({
			kind: 'rateLimit', retryAfterSec: 8, limit: 2, resetAt: Math.ceil((1_000_000 + 10_000) / 1000),
		});
		c.advance(7_500);
		expect(s.check('hubspot', req())).toBeNull();
	});

	it('retryAfterSec is at least 1', () => {
		const c = clock();
		const s = new ScenarioController(c.now);
		s.setLimit('x', { calls: 1, perMs: 500 });
		s.check('x', req());
		c.advance(499);
		expect(s.check('x', req())).toMatchObject({ kind: 'rateLimit', retryAfterSec: 1 });
	});

	it('counts and limits only calls matching the route filter', () => {
		const s = new ScenarioController(clock().now);
		s.setLimit('hubspot', { calls: 1, perMs: 60_000, route: { method: 'POST', path: '/crm/v3/objects/:type' } });
		expect(s.check('hubspot', req('GET', '/crm/v3/objects/contacts'))).toBeNull();
		expect(s.check('hubspot', req('POST', '/crm/v3/objects/contacts'))).toBeNull();
		expect(s.check('hubspot', req('GET', '/crm/v3/objects/contacts'))).toBeNull();
		expect(s.check('hubspot', req('POST', '/crm/v3/objects/deals'))).toMatchObject({ kind: 'rateLimit' });
		expect(s.check('hubspot', req('POST', '/other'))).toBeNull();
	});

	it('method * matches any method', () => {
		const s = new ScenarioController(clock().now);
		s.setLimit('x', { calls: 1, perMs: 60_000, route: { method: '*', path: '/a' } });
		s.check('x', req('GET', '/a'));
		expect(s.check('x', req('DELETE', '/a'))).toMatchObject({ kind: 'rateLimit' });
	});

	it('auth wins over a limit, and auth-rejected and limited calls are not counted', () => {
		const c = clock();
		const s = new ScenarioController(c.now);
		s.setLimit('x', { calls: 1, perMs: 60_000 });
		s.setAuth('x', 'forbidden');
		expect(s.check('x', req())).toEqual({ kind: 'auth', mode: 'forbidden' });
		expect(s.check('x', req())).toEqual({ kind: 'auth', mode: 'forbidden' });
		s.clearAuth();
		expect(s.check('x', req())).toBeNull();
		expect(s.check('x', req())).toMatchObject({ kind: 'rateLimit' });
		expect(s.check('x', req())).toMatchObject({ kind: 'rateLimit' });
	});

	it('setLimit replaces the previous limit and resets its window', () => {
		const s = new ScenarioController(clock().now);
		s.setLimit('x', { calls: 1, perMs: 60_000 });
		s.check('x', req());
		s.setLimit('x', { calls: 1, perMs: 60_000 });
		expect(s.check('x', req())).toBeNull();
	});

	it('clears one or all, and snapshots', () => {
		const s = new ScenarioController();
		s.setAuth('a', 'revoked');
		s.setAuth('b', 'forbidden');
		s.setLimit('a', { calls: 5, perMs: 1000 });
		expect(s.snapshot()).toEqual({
			auth: { a: 'revoked', b: 'forbidden' },
			limits: { a: { calls: 5, perMs: 1000 } },
		});
		s.clearAuth();
		s.clearLimit('a');
		expect(s.snapshot()).toEqual({ auth: {}, limits: {} });
	});
});

const pack = (id: string, scenarios?: ServicePack['scenarios']): ServicePack => ({
	id, domains: [], prefix: `/${id}`, source: 'library', routes: [], ...(scenarios ? { scenarios } : {}),
});

describe('scenarioResponse', () => {
	const rl = { kind: 'rateLimit' as const, retryAfterSec: 3, limit: 10, resetAt: 1_700_000_000 };

	it('falls back to generic answers', () => {
		expect(scenarioResponse({ kind: 'auth', mode: 'revoked' }, undefined, req())).toMatchObject({
			status: 401, body: { error: 'unauthorized' }, matched: 'unmatched',
		});
		expect(scenarioResponse({ kind: 'auth', mode: 'forbidden' }, {}, req())).toMatchObject({
			status: 403, body: { error: 'forbidden' },
		});
		const r = scenarioResponse(rl, undefined, req());
		expect(r).toMatchObject({ status: 429, body: { error: 'rate limited' } });
		expect(r.headers['retry-after']).toBe('3');
		expect(r.headers['content-type']).toBe('application/json');
	});

	it('renders the pack shape with retryAfter, limit and resetAt; header values are strings', () => {
		const r = scenarioResponse(rl, {
			rateLimit: {
				status: 429,
				headers: { 'X-RateLimit-Max': '{{limit}}', 'retry-after': '{{retryAfter}}' },
				body: { message: 'slow down, reset {{resetAt}}', retry: '{{retryAfter}}' },
			},
		}, req());
		expect(r.headers).toMatchObject({ 'x-ratelimit-max': '10', 'retry-after': '3' });
		expect(r.body).toEqual({ message: 'slow down, reset 1700000000', retry: 3 });
	});

	it('adds retry-after when the pack rateLimit shape leaves it out', () => {
		const r = scenarioResponse(rl, { rateLimit: { status: 403, body: { errorCode: 'REQUEST_LIMIT_EXCEEDED' } } }, req());
		expect(r.status).toBe(403);
		expect(r.headers['retry-after']).toBe('3');
	});

	it('does not put a note on the wire', () => {
		const r = scenarioResponse({ kind: 'auth', mode: 'revoked' }, { revoked: { status: 200, body: { ok: false }, note: 'docs' } }, req());
		expect(r).toMatchObject({ status: 200, body: { ok: false } });
		expect(JSON.stringify(r)).not.toContain('docs');
	});
});

describe('scenarioShapes', () => {
	it('takes the nearest layer that has a scenarios block', () => {
		const lib = pack('slack', { revoked: { status: 200, body: { ok: false, error: 'invalid_auth' } } });
		const proj = pack('slack');
		expect(scenarioShapes({ snapshot: [], project: [proj], user: [], library: [lib] }, 'slack')).toBe(lib.scenarios);
		const user = pack('slack', { revoked: { status: 401 } });
		expect(scenarioShapes({ snapshot: [], project: [proj], user: [user], library: [lib] }, 'slack')).toBe(user.scenarios);
		expect(scenarioShapes({ snapshot: [], project: [], user: [], library: [] }, 'slack')).toBeUndefined();
	});
});