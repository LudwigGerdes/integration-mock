import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestLog, FaultController, type LayeredPacks } from 'integration-mock-core';
import { ensureCA } from '../src/ca.js';
import { MockEngine } from '../src/state.js';
import { startProxy } from '../src/server.js';

let proxy: Awaited<ReturnType<typeof startProxy>>;
let engine: MockEngine;
let log: RequestLog;

const packs: LayeredPacks = {
	library: [
		{
			id: 'weather',
			domains: ['api.example.com'],
			prefix: '/weather',
			source: 'library',
			routes: [
				{
					id: 'now',
					match: { method: 'GET', path: '/dev/weather' },
					respond: { status: 200, body: { city: 'Evanston', tempC: 14 } },
				},
			],
		},
	],
	user: [],
	project: [],
	snapshot: [],
};

beforeAll(async () => {
	log = new RequestLog();
	engine = new MockEngine({
		packs,
		log,
		faults: new FaultController(),
		enabledPacks: ['weather'],
	});
	engine.setMode('replay');
	proxy = await startProxy({
		engine,
		ca: await ensureCA(mkdtempSync(join(tmpdir(), 'burl-ca-'))),
		port: 0,
		adminPort: 0,
	});
});

afterAll(() => proxy.close());

const get = (path: string): Promise<Response> => fetch(`http://127.0.0.1:${proxy.port}${path}`);

describe('base-URL mode', () => {
	it('serves a pack route from a direct request', async () => {
		const res = await get('/weather/dev/weather');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ city: 'Evanston', tempC: 14 });
	});

	it('logs it as the vendor host, so both modes look identical in the log', async () => {
		log.clear();
		await get('/weather/dev/weather');
		expect(log.list()[0]).toMatchObject({
			service: 'weather',
			method: 'GET',
			path: '/dev/weather',
			url: 'https://api.example.com/dev/weather',
			status: 200,
		});
	});

	it('404s a path no pack claims, naming the path', async () => {
		const res = await get('/nope/x');
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ path: '/nope/x' });
	});

	it('serves the loud 501 for an unmatched route inside a claimed prefix', async () => {
		const res = await get('/weather/not-a-route');
		expect(res.status).toBe(501);
	});

	it('passes query strings through to matching', async () => {
		const res = await get('/weather/dev/weather?units=c');
		expect(res.status).toBe(200);
	});
});
