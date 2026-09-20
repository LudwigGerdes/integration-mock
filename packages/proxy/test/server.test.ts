import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, ProxyAgent, request } from 'undici';
import { RequestLog, FaultController, type LayeredPacks } from 'integration-mock-core';
import { ensureCA } from '../src/ca.js';
import { MockEngine } from '../src/state.js';
import { startProxy } from '../src/server.js';
import { startOrigin, type Origin } from './helpers/origin.js';

// The origin listens on 127.0.0.1:<port>; we address it as host "localhost" so
// the pack domain can be "localhost" and the leaf SAN matches.
let origin: Origin;
let proxy: Awaited<ReturnType<typeof startProxy>>;
let engine: MockEngine;
let log: RequestLog;
let faults: FaultController;
let caPem: string;

beforeAll(async () => {
	origin = await startOrigin();
	const ca = await ensureCA(mkdtempSync(join(tmpdir(), 'pca-')));
	caPem = ca.certPem;
	log = new RequestLog();
	faults = new FaultController();
	const packs: LayeredPacks = {
		library: [
			{
				id: 'orig',
				domains: ['localhost'],
				prefix: '/orig',
				source: 'library',
				routes: [
					{
						id: 'hello',
						match: { method: 'GET', path: '/hello' },
						respond: { status: 200, body: { from: 'mock' } },
					},
				],
			},
		],
		user: [],
		project: [],
		snapshot: [],
	};
	engine = new MockEngine({ packs, log, faults, enabledPacks: ['orig'] });
	proxy = await startProxy({
		engine,
		ca,
		port: 0,
		// Ephemeral admin port too: the 8081 default collides with any proxy or
		// docker pair the developer happens to have running.
		adminPort: 0,
		upstream: new Agent({ connect: { ca: [origin.caPem] } }),
	});
});

afterAll(async () => {
	await proxy.close();
	await origin.close();
});

const via = (path: string, method = 'GET') =>
	request(`https://localhost:${origin.port}${path}`, {
		method: method as 'GET',
		dispatcher: new ProxyAgent({
			uri: `http://127.0.0.1:${proxy.port}`,
			requestTls: { ca: [caPem, origin.caPem] },
		}),
	});

describe('proxy server', () => {
	it('off: tunnels untouched, nothing logged', async () => {
		engine.setMode('off');
		origin.seen.length = 0;
		const r = await via('/hello');
		expect(await r.body.json()).toEqual({ from: 'origin', path: '/hello' });
		expect(origin.seen).toEqual(['GET /hello']);
		expect(log.list()).toHaveLength(0);
	});

	it('replay: serves mock, origin untouched, logged', async () => {
		engine.setMode('replay');
		origin.seen.length = 0;
		log.clear();
		const r = await via('/hello');
		expect(await r.body.json()).toEqual({ from: 'mock' });
		expect(origin.seen).toEqual([]);
		expect(log.list()[0]!.matchedRoute).toBe('hello');
	});

	it('replay: unmatched → 501 with spec body', async () => {
		engine.setMode('replay');
		const r = await via('/nope', 'POST');
		expect(r.statusCode).toBe(501);
		expect(await r.body.json()).toMatchObject({
			error: 'integration-mock: no route',
			service: 'orig',
			method: 'POST',
			path: '/nope',
		});
	});

	it('fault 503 after:1 once', async () => {
		engine.setMode('replay');
		faults.set('orig', { status: 503, after: 1, once: true });
		expect((await via('/hello')).statusCode).toBe(200);
		expect((await via('/hello')).statusCode).toBe(503);
		expect((await via('/hello')).statusCode).toBe(200);
	});

	it('record: forwards to origin, logs passthrough, then replays from recorded pack', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'rec-'));
		const realCwd = process.cwd;
		process.cwd = () => cwd;
		try {
			engine.setMode('record');
			origin.seen.length = 0;
			log.clear();
			const r = await via('/recorded?x=1');
			expect(await r.body.json()).toEqual({ from: 'origin', path: '/recorded?x=1' });
			expect(origin.seen).toEqual(['GET /recorded?x=1']);
			expect(log.list()[0]!.matchedRoute).toBe('passthrough');

			engine.setMode('replay');
			origin.seen.length = 0;
			const r2 = await via('/recorded?x=1');
			expect(await r2.body.json()).toEqual({ from: 'origin', path: '/recorded?x=1' });
			expect(origin.seen).toEqual([]);
		} finally {
			process.cwd = realCwd;
		}
	});
});
