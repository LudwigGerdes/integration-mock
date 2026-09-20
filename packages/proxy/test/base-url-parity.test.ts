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

let origin: Origin;
let proxy: Awaited<ReturnType<typeof startProxy>>;
let engine: MockEngine;
let caPem: string;

beforeAll(async () => {
	origin = await startOrigin();
	const ca = await ensureCA(mkdtempSync(join(tmpdir(), 'parity-ca-')));
	caPem = ca.certPem;
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
						respond: { status: 200, body: { from: 'mock', n: 1 } },
					},
				],
			},
		],
		user: [],
		project: [],
		snapshot: [],
	};
	engine = new MockEngine({
		packs,
		log: new RequestLog(),
		faults: new FaultController(),
		enabledPacks: ['orig'],
	});
	engine.setMode('replay');
	proxy = await startProxy({ engine, ca, port: 0, adminPort: 0 });
});

afterAll(async () => {
	await proxy.close();
	await origin.close();
});

describe('mode parity', () => {
	it('serves byte-identical bodies through the proxy and over base-URL', async () => {
		// Proxy mode: CONNECT + TLS termination, addressed as the vendor.
		const viaProxy = await request(`https://localhost:${origin.port}/hello`, {
			dispatcher: new ProxyAgent({
				uri: `http://127.0.0.1:${proxy.port}`,
				requestTls: { ca: caPem },
			}),
		});
		const proxyBody = await viaProxy.body.text();

		// Base-URL mode: plain HTTP, addressed by prefix.
		const viaBaseUrl = await request(`http://127.0.0.1:${proxy.port}/orig/hello`, {
			dispatcher: new Agent(),
		});
		const baseUrlBody = await viaBaseUrl.body.text();

		expect(viaProxy.statusCode).toBe(200);
		expect(viaBaseUrl.statusCode).toBe(200);
		expect(baseUrlBody).toBe(proxyBody);
	});

	// Spec D6, asserted rather than assumed: `off` governs interception only.
	it('base-URL still serves when mode is off, and the proxy tunnels', async () => {
		engine.setMode('off');
		const res = await request(`http://127.0.0.1:${proxy.port}/orig/hello`, {
			dispatcher: new Agent(),
		});
		expect(res.statusCode).toBe(200);
		expect(engine.shouldIntercept('localhost')).toBeNull();
		engine.setMode('replay');
	});
});
