import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestLog, FaultController } from 'integration-mock-core';
import { MockEngine, startAdmin } from 'integration-mock-proxy';
import { buildProgram } from '../src/index.js';

let admin: Awaited<ReturnType<typeof startAdmin>>;
let engine: MockEngine;

const run = async (args: string[]): Promise<string> => {
	const out: string[] = [];
	await buildProgram({ write: (s) => out.push(s) }).parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

beforeAll(async () => {
	engine = new MockEngine({
		packs: { library: [], user: [], project: [], snapshot: [] },
		log: new RequestLog(),
		faults: new FaultController(),
	});
	admin = await startAdmin({ engine, port: 0 });
});

afterAll(() => admin.close());

beforeEach(() => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	writeFileSync(
		join(process.env.INTEGRATION_MOCK_HOME, 'proxy.json'),
		JSON.stringify({ port: 1, adminPort: admin.port, pid: process.pid }),
	);
});

describe('proxy cli', () => {
	it('on/off/status', async () => {
		await run(['on']);
		expect(engine.state().mode).toBe('replay');
		expect(await run(['status'])).toMatch(/mode\s+replay/);
		await run(['off']);
		expect(engine.state().mode).toBe('off');
	});

	it('record start/stop', async () => {
		await run(['record', 'start']);
		expect(engine.state().mode).toBe('record');
		await run(['record', 'stop']);
		expect(engine.state().mode).toBe('replay');
	});

	it('faults set/clear', async () => {
		await run(['faults', 'set', 'slack', '--status', '503', '--after', '1', '--once']);
		expect(engine.state().faults).toEqual({ slack: { status: 503, after: 1, once: true } });
		await run(['faults', 'clear']);
		expect(engine.state().faults).toEqual({});
	});

	it('log prints entries', async () => {
		engine.logRef.append({
			service: 'slack',
			method: 'POST',
			url: 'u',
			path: '/api/chat.postMessage',
			query: {},
			reqHeaders: {},
			status: 200,
			resHeaders: {},
			latencyMs: 3,
			matchedRoute: 'r',
		});
		expect(await run(['log', '--service', 'slack'])).toMatch(
			/POST\s+slack\s+\/api\/chat\.postMessage\s+200/,
		);
	});

	it('errors when proxy.json missing', async () => {
		process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'empty-'));
		await expect(run(['on'])).rejects.toThrow(/proxy not running/);
	});

	it('ca install prints env lines', async () => {
		const out = await run(['ca', 'install']);
		expect(out).toMatch(/HTTPS_PROXY=http:\/\//);
		expect(out).toMatch(/NODE_EXTRA_CA_CERTS=.*ca\.pem/);
		expect(out).toMatch(/# hosted n8n .*<public-host>/);
	});

	it('ca install prints NO_PROXY in every form, which n8n\'s task runner needs', async () => {
		const out = await run(['ca', 'install']);
		expect(out.match(/NO_PROXY[=:] ?localhost,127\.0\.0\.1/g)).toHaveLength(3);
	});

	it('ca install defaults to the port the running mock listens on', async () => {
		writeFileSync(
			join(process.env.INTEGRATION_MOCK_HOME!, 'proxy.json'),
			JSON.stringify({ port: 9191, adminPort: 9192, pid: 0 }),
		);
		expect(await run(['ca', 'install'])).toMatch(/HTTP_PROXY=http:\/\/127\.0\.0\.1:9191/);
		expect(await run(['ca', 'install', '--port', '7000'])).toMatch(/HTTP_PROXY=http:\/\/127\.0\.0\.1:7000/);
	});
});

describe('docker pair', () => {
	it('resolves the compose file shipped with the repo', async () => {
		const { composeFile } = await import('../src/commands/proxy.js');
		const { readFile } = await import('node:fs/promises');
		expect(composeFile()).toMatch(/docker\/docker-compose\.yml$/);
		const yml = await readFile(composeFile(), 'utf8');
		expect(yml).toMatch(/HTTPS_PROXY: http:\/\/mock:8080/);
		expect(yml).toMatch(/NODE_EXTRA_CA_CERTS: \/data\/ca\.pem/);
		expect(yml).toMatch(/condition: service_healthy/);
		// Invariant I1: an unpinned image silently ran 1.44.1 against a project
		// that targeted 2.10.0, and nothing complained. Assert against the
		// constant rather than a literal so a retarget updates both together.
		const { SUPPORTED_N8N_VERSION } = await import('integration-mock-core');
		expect(yml).toContain(`image: docker.n8n.io/n8nio/n8n:\${N8N_VERSION:-${SUPPORTED_N8N_VERSION}}`);
		expect(yml).not.toMatch(/image: docker\.n8n\.io\/n8nio\/n8n\s*$/m);
	});
});

describe('packs enable reaches a running proxy', () => {
	it('pushes the enabled list to the admin API', async () => {
		const project = mkdtempSync(join(tmpdir(), 'proj-'));
		const prev = process.cwd();
		process.chdir(project);
		try {
			await run(['packs', 'enable', 'slack']);
			expect(engine.state().enabledPacks).toContain('slack');
			await run(['packs', 'disable', 'slack']);
			expect(engine.state().enabledPacks).not.toContain('slack');
		} finally {
			process.chdir(prev);
		}
	});

	it('still writes config when no proxy is running', async () => {
		process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'noproxy-'));
		const project = mkdtempSync(join(tmpdir(), 'proj-'));
		const prev = process.cwd();
		process.chdir(project);
		try {
			// A library pack: `enable` refuses ids no layer holds.
			await run(['packs', 'enable', 'slack']);
			const { loadProjectConfig } = await import('integration-mock-core');
			expect((await loadProjectConfig()).enabledPacks).toEqual(['slack']);
		} finally {
			process.chdir(prev);
		}
	});
});
