import { describe, it, expect } from 'vitest';
import { ScenarioController } from '../src/scenarios.js';
import type { MockRequest } from '../src/types.js';

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
