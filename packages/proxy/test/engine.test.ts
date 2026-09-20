import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	RequestLog,
	FaultController,
	loadPack,
	type LayeredPacks,
	type MockRequest,
	type ServicePack,
	type Snapshot,
} from 'integration-mock-core';
import { MockEngine } from '../src/state.js';

const req = (o: Partial<MockRequest>): MockRequest => ({
	method: 'GET',
	host: 'slack.com',
	path: '/api/x',
	query: {},
	headers: {},
	...o,
});

const slack: ServicePack = {
	id: 'slack',
	domains: ['slack.com', '*.slack.com'],
	prefix: '/slack',
	source: 'library',
	routes: [
		{ id: 'x', match: { method: 'GET', path: '/api/x' }, respond: { status: 200, body: { ok: true } } },
	],
	seed: { things: [{ id: 't1' }] },
};

const mk = (over: Partial<LayeredPacks> = {}, enabled = ['slack']) => {
	const log = new RequestLog();
	const faults = new FaultController();
	const engine = new MockEngine({
		packs: { library: [slack], user: [], project: [], snapshot: [], ...over },
		log,
		faults,
		enabledPacks: enabled,
	});
	return { engine, log, faults };
};

describe('MockEngine', () => {
	it('starts off; shouldIntercept respects mode + enabled', () => {
		const { engine } = mk();
		expect(engine.state().mode).toBe('off');
		expect(engine.shouldIntercept('api.slack.com')).toBeNull();
		engine.setMode('replay');
		expect(engine.shouldIntercept('api.slack.com')).toBe('slack');
		engine.setEnabledPacks([]);
		expect(engine.shouldIntercept('api.slack.com')).toBeNull();
		expect(engine.shouldIntercept('example.com')).toBeNull();
	});

	it('replay resolves and logs with layer', async () => {
		const { engine, log } = mk();
		engine.setMode('replay');
		const res = await engine.handleReplay('slack', req({}));
		expect(res.body).toEqual({ ok: true });
		const e = log.list()[0]!;
		expect(e.matchedRoute).toBe('x');
		expect(e.layer).toBe('library');
		expect(e.status).toBe(200);
		expect(e.fault).toBeUndefined();
	});

	it('store is seeded per service and resettable', async () => {
		const { engine } = mk();
		engine.setMode('replay');
		expect((await engine.handleReplay('slack', req({ path: '/things' }))).body).toEqual({
			data: [{ id: 't1' }],
		});
		await engine.handleReplay('slack', req({ method: 'POST', path: '/things', body: { id: 't2' } }));
		expect(
			((await engine.handleReplay('slack', req({ path: '/things' }))).body as { data: unknown[] })
				.data,
		).toHaveLength(2);
		engine.resetStores();
		expect(
			((await engine.handleReplay('slack', req({ path: '/things' }))).body as { data: unknown[] })
				.data,
		).toHaveLength(1);
	});

	it('faults: status, empty, delay, after/once, and logged', async () => {
		const { engine, faults, log } = mk();
		engine.setMode('replay');
		faults.set('slack', { status: 503, after: 1, once: true });
		expect((await engine.handleReplay('slack', req({}))).status).toBe(200);
		const f = await engine.handleReplay('slack', req({}));
		expect(f.status).toBe(503);
		expect(f.matched).toBe('unmatched');
		expect(log.list()[1]!.fault).toEqual({ status: 503 });
		expect((await engine.handleReplay('slack', req({}))).status).toBe(200);

		faults.set('slack', { empty: true });
		expect((await engine.handleReplay('slack', req({}))).body).toBeUndefined();

		faults.set('slack', { delayMs: 20 });
		const t = Date.now();
		const d = await engine.handleReplay('slack', req({}));
		expect(Date.now() - t).toBeGreaterThanOrEqual(18);
		expect(d.body).toEqual({ ok: true });
	});

	it('record appends route, saves pack, replays immediately', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'rec-'));
		const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
		const { engine, log } = mk({ library: [] }, ['hub']);
		engine.setMode('record');
		engine.registerPack({ id: 'hub', domains: ['hub.com'], prefix: '/hub', routes: [], source: 'library' });
		const r = req({ host: 'hub.com', path: '/v1/items', query: { page: '1' } });
		await engine.recordUpstream('hub', r, {
			status: 200,
			headers: { 'content-type': 'application/json', 'x-junk': '1' },
			body: [{ id: 1 }],
		});
		expect(log.list()[0]!.matchedRoute).toBe('passthrough');
		const saved = await loadPack(join(cwd, '.integration-mock', 'packs', 'hub'));
		expect(saved.routes[0]).toEqual({
			id: 'hub:GET:/v1/items#0',
			match: { method: 'GET', path: '/v1/items', query: { page: '1' } },
			respond: {
				status: 200,
				headers: { 'content-type': 'application/json' },
				body: [{ id: 1 }],
			},
		});
		engine.setMode('replay');
		expect((await engine.handleReplay('hub', r)).matched).toEqual({
			routeId: 'hub:GET:/v1/items#0',
			layer: 'project',
		});
		spy.mockRestore();
	});

	it('activateSnapshot enables its services and wins resolution', async () => {
		const { engine } = mk({}, []);
		const snap: Snapshot = {
			executionId: 'e',
			workflowId: 'w',
			instance: 'i',
			createdAt: 0,
			workflowHash: '',
			nodeHashes: {},
			warnings: [],
			nodeOutputs: {},
			packs: [
				{
					...slack,
					source: 'snapshot:e',
					routes: [
						{ id: 's', match: { method: 'GET', path: '/api/x' }, respond: { status: 200, body: 'S' } },
					],
				},
			],
		};
		engine.activateSnapshot(snap);
		engine.setMode('replay');
		expect(engine.state().enabledPacks).toContain('slack');
		expect((await engine.handleReplay('slack', req({}))).body).toBe('S');
		engine.activateSnapshot(undefined);
		expect((await engine.handleReplay('slack', req({}))).body).toEqual({ ok: true });
	});
});

describe('serviceForBaseUrl', () => {
	const engineWith = (mode: 'off' | 'replay'): MockEngine => {
		const e = new MockEngine({
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
			log: new RequestLog(),
			faults: new FaultController(),
			enabledPacks: ['weather'],
		});
		e.setMode(mode);
		return e;
	};

	it('strips the prefix and reports the pack canonical host', () => {
		expect(engineWith('replay').serviceForBaseUrl('/weather/dev/weather')).toEqual({
			service: 'weather',
			rest: '/dev/weather',
			host: 'api.example.com',
		});
	});

	it('treats the bare prefix as root', () => {
		expect(engineWith('replay').serviceForBaseUrl('/weather')).toMatchObject({ rest: '/' });
	});

	// Spec D6: base-URL is explicit intent, so it does not consult mode.
	it('serves even when mode is off', () => {
		expect(engineWith('off').serviceForBaseUrl('/weather/x')).toMatchObject({
			service: 'weather',
		});
	});

	it('returns null for an unknown prefix', () => {
		expect(engineWith('replay').serviceForBaseUrl('/nope/x')).toBeNull();
	});

	it('returns null for a pack that is not enabled', () => {
		const e = engineWith('replay');
		e.setEnabledPacks([]);
		expect(e.serviceForBaseUrl('/weather/x')).toBeNull();
	});
});

it('serves a pack that claims no vendor domain, reachable only by prefix', () => {
	const e = new MockEngine({
		packs: {
			library: [
				{ id: 'generic-rest', domains: [], prefix: '/generic-rest', source: 'library', routes: [] },
			],
			user: [],
			project: [],
			snapshot: [],
		},
		log: new RequestLog(),
		faults: new FaultController(),
		enabledPacks: ['generic-rest'],
	});
	e.setMode('replay');
	expect(e.serviceForBaseUrl('/generic-rest/items')).toEqual({
		service: 'generic-rest',
		rest: '/items',
		host: 'generic-rest.integration-mock.local',
	});
});

describe('MockEngine.replaceLayers', () => {
	it('swaps a layer so a pack written after boot becomes servable', () => {
		const { engine } = mk({}, ['acme']);
		expect(engine.serviceForBaseUrl('/acme/example')).toBeNull();
		engine.replaceLayers({
			project: [
				{ id: 'acme', domains: ['api.acme.test'], prefix: '/acme', source: 'authored', routes: [] },
			],
		});
		expect(engine.serviceForBaseUrl('/acme/example')).toMatchObject({ service: 'acme', rest: '/example' });
		expect(engine.enabledPrefixes()).toEqual({ acme: '/acme' });
	});

	it('keeps an in-progress recording pack when the project layer is reloaded', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'rec-'));
		process.chdir(dir);
		const { engine } = mk({}, ['slack']);
		await engine.recordUpstream('slack', req({ path: '/api/a' }), {
			status: 200,
			headers: {},
			body: { a: 1 },
		});
		// Reload with a stale on-disk view (no routes) — the live recording wins.
		engine.replaceLayers({
			project: [{ id: 'slack', domains: ['slack.com'], prefix: '/slack', source: 'recorded', routes: [] }],
		});
		engine.setMode('replay');
		const res = await engine.handleReplay('slack', req({ path: '/api/a' }));
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ a: 1 });
	});
});
