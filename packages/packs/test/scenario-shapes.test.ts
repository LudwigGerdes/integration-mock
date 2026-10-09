import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadPack, scenarioResponse, type MockRequest } from 'integration-mock-core';
import { libraryPacksDir } from '../src/library.js';

const loadShipped = (id: string) => loadPack(join(libraryPacksDir(), id));

const req: MockRequest = { method: 'GET', host: 'h', path: '/', query: {}, headers: {} };
const rl = { kind: 'rateLimit' as const, retryAfterSec: 7, limit: 100, resetAt: 1_700_000_000 };
const PACKS = ['slack', 'stripe', 'hubspot', 'salesforce', 'openai', 'gmail', 'google-drive', 'google-sheets'];

describe('shipped scenario shapes', () => {
	it.each(PACKS)('%s declares its documented shapes, each citing a source', async (id) => {
		const s = (await loadShipped(id)).scenarios;
		const keys = id === 'openai' ? (['revoked', 'rateLimit'] as const) : (['revoked', 'forbidden', 'rateLimit'] as const);
		for (const k of keys) {
			expect(s?.[k]?.note, `${id}.${k}.note`).toMatch(/^https:\/\//);
		}
	});

	it('slack revoked is HTTP 200 invalid_auth', async () => {
		const r = scenarioResponse({ kind: 'auth', mode: 'revoked' }, (await loadShipped('slack')).scenarios, req);
		expect(r).toMatchObject({ status: 200, body: { ok: false, error: 'invalid_auth' } });
	});

	it('salesforce rate limit is 403 REQUEST_LIMIT_EXCEEDED with retry-after', async () => {
		const r = scenarioResponse(rl, (await loadShipped('salesforce')).scenarios, req);
		expect(r.status).toBe(403);
		expect(JSON.stringify(r.body)).toContain('REQUEST_LIMIT_EXCEEDED');
		expect(r.headers['retry-after']).toBe('7');
	});

	it('hubspot rate limit carries its rate-limit headers', async () => {
		const r = scenarioResponse(rl, (await loadShipped('hubspot')).scenarios, req);
		expect(r.status).toBe(429);
		expect(r.headers['x-hubspot-ratelimit-daily']).toBe('100');
		expect(r.headers['x-hubspot-ratelimit-daily-remaining']).toBe('0');
		expect(r.body).toMatchObject({ errorType: 'RATE_LIMIT', policyName: 'DAILY' });
	});

	it.each(PACKS)('%s rate limit always carries retry-after', async (id) => {
		expect(scenarioResponse(rl, (await loadShipped(id)).scenarios, req).headers['retry-after']).toBeDefined();
	});

	it('openai documents no permission-error body, so forbidden falls back to the generic 403', async () => {
		const r = scenarioResponse({ kind: 'auth', mode: 'forbidden' }, (await loadShipped('openai')).scenarios, req);
		expect(r).toMatchObject({ status: 403, body: { error: 'forbidden' } });
	});

	it('generic-rest has no scenarios block (generic answers)', async () => {
		expect((await loadShipped('generic-rest')).scenarios).toBeUndefined();
	});
});
