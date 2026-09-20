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
		packs: {
			library: [
				{
					id: 'weather',
					domains: ['api.example.com'],
					prefix: '/weather',
					source: 'library',
					routes: [],
				},
				{
					// A prefix that is NOT '/' + id: the verb must read the prefix.
					id: 'acme',
					domains: ['api.acme.test'],
					prefix: '/vendor/acme',
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
	});
	admin = await startAdmin({ engine, port: 0 });
});

afterAll(() => admin.close());

beforeEach(() => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'urlhome-'));
	writeFileSync(
		join(process.env.INTEGRATION_MOCK_HOME, 'proxy.json'),
		JSON.stringify({ port: 9099, adminPort: admin.port, pid: process.pid }),
	);
	engine.setEnabledPacks(['weather', 'acme']);
});

describe('url', () => {
	it('prints one base URL per enabled pack, on the daemon port', async () => {
		const out = await run(['url']);
		expect(out).toContain('http://127.0.0.1:9099/weather');
		expect(out).toContain('http://127.0.0.1:9099/vendor/acme');
	});

	it('uses the prefix, not the pack id', async () => {
		expect(await run(['url', 'acme'])).toBe('http://127.0.0.1:9099/vendor/acme');
	});

	it('guides the user when nothing is enabled', async () => {
		engine.setEnabledPacks([]);
		expect(await run(['url'])).toMatch(/packs enable/);
	});

	it('fails loudly for a service that is not enabled', async () => {
		await expect(run(['url', 'nope'])).rejects.toThrow(/not enabled/);
	});
});
