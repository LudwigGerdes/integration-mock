import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RequestLog, FaultController } from 'integration-mock-core';
import { MockEngine } from '../src/state.js';
import { startAdmin, AdminClient } from '../src/admin.js';

let admin: Awaited<ReturnType<typeof startAdmin>>;
let client: AdminClient;
let engine: MockEngine;
let log: RequestLog;

beforeAll(async () => {
	log = new RequestLog();
	engine = new MockEngine({
		packs: {
			library: [
				{
					id: 'weather',
					domains: ['api.example.com'],
					prefix: '/weather',
					source: 'library',
					routes: [],
				},
			],
			user: [],
			project: [],
			snapshot: [],
		},
		log,
		faults: new FaultController(),
	});
	admin = await startAdmin({ engine, port: 0 });
	client = new AdminClient(`http://127.0.0.1:${admin.port}`);
});

afterAll(() => admin.close());

describe('admin api', () => {
	it('state + mode + packs', async () => {
		expect((await client.getState()).mode).toBe('off');
		await client.setMode('replay');
		await client.setEnabledPacks(['slack']);
		expect(await client.getState()).toMatchObject({ mode: 'replay', enabledPacks: ['slack'] });
	});

	it('faults set/clear', async () => {
		await client.setFault('slack', { status: 500 });
		expect((await client.getState()).faults).toEqual({ slack: { status: 500 } });
		await client.clearFaults('slack');
		expect((await client.getState()).faults).toEqual({});
	});

	it('log get/clear', async () => {
		log.append({
			service: 's',
			method: 'GET',
			url: 'u',
			path: '/p',
			query: {},
			reqHeaders: {},
			status: 200,
			resHeaders: {},
			latencyMs: 1,
			matchedRoute: 'r',
		});
		expect(await client.getLog({ service: 's' })).toHaveLength(1);
		await client.clearLog();
		expect(await client.getLog()).toHaveLength(0);
	});

	it('snapshot activate/clear reduces in state', async () => {
		await client.activateSnapshot({
			executionId: 'e1',
			workflowId: 'w1',
			instance: 'i',
			createdAt: 1,
			workflowHash: '',
			nodeHashes: {},
			packs: [],
			nodeOutputs: {},
			warnings: [],
		});
		expect((await client.getState()).activeSnapshot).toEqual({
			executionId: 'e1',
			workflowId: 'w1',
		});
		await client.clearSnapshot();
		expect((await client.getState()).activeSnapshot).toBeUndefined();
	});

	it('resetPacks ok', async () => {
		await expect(client.resetPacks()).resolves.toBeUndefined();
	});

	it('reports the prefix of each enabled pack', async () => {
		engine.setEnabledPacks(['weather']);
		expect((await client.getState()).packPrefixes).toEqual({ weather: '/weather' });
	});
});

describe('admin api pack reload', () => {
	it('re-reads the pack layers before applying a new enabled list', async () => {
		// `packs init` writes a pack to disk while the daemon is running. Without a
		// reload the daemon keeps its boot-time layers: `enable` says enabled,
		// `url` says not enabled, and the route 404s until a restart.
		let reloads = 0;
		const reloadable = new MockEngine({
			packs: { library: [], user: [], project: [], snapshot: [] },
			log: new RequestLog(),
			faults: new FaultController(),
		});
		const srv = await startAdmin({
			engine: reloadable,
			port: 0,
			reloadPacks: async () => {
				reloads++;
				reloadable.replaceLayers({
					project: [
						{ id: 'acme', domains: ['api.acme.test'], prefix: '/acme', source: 'authored', routes: [] },
					],
				});
			},
		});
		try {
			const c = new AdminClient(`http://127.0.0.1:${srv.port}`);
			await c.setEnabledPacks(['acme']);
			expect(reloads).toBe(1);
			expect((await c.getState()).packPrefixes).toEqual({ acme: '/acme' });
		} finally {
			await srv.close();
		}
	});
});
