import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import { saveSources } from 'integration-mock-packs';
import { buildProgram } from '../src/index.js';
import {
	setAuditDispatcherForTests,
	setSourcesFileForTests,
} from '../src/commands/packs-audit.js';

const run = async (args: string[]): Promise<string> => {
	const out: string[] = [];
	await buildProgram({ write: (s) => out.push(s) }).parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

const SPEC = JSON.stringify({
	openapi: '3.0.0',
	servers: [{ url: 'https://api.good.test' }],
	paths: {
		'/a': { get: { responses: { '200': { content: { 'application/json': { example: { x: 1 } } } } } } },
	},
});

beforeEach(async () => {
	const f = join(mkdtempSync(join(tmpdir(), 'aud-')), 'sources.yaml');
	await saveSources(
		{
			good: { url: 'https://good.test/openapi.json', license: 'MIT', vendored: true },
			dead: { url: 'https://dead.test/openapi.json', license: 'unknown', vendored: false },
			unresearched: { url: '', license: 'unknown', vendored: false },
		},
		f,
	);
	setSourcesFileForTests(f);

	const a = new MockAgent();
	a.disableNetConnect();
	a.get('https://good.test')
		.intercept({ path: '/openapi.json', method: 'GET' })
		.reply(200, SPEC)
		.persist();
	a.get('https://dead.test')
		.intercept({ path: '/openapi.json', method: 'GET' })
		.reply(503, '')
		.persist();
	setAuditDispatcherForTests(a);
});

describe('packs audit', () => {
	it('reports a viable vendor and survives a dead one', async () => {
		const rows = JSON.parse(await run(['packs', 'audit', '--json'])) as Array<Record<string, unknown>>;
		const good = rows.find((r) => r.service === 'good')!;
		expect(good).toMatchObject({
			ok: true,
			operations: 1,
			routes: 1,
			format: 'json',
			openapi: '3.0.0',
			license: 'MIT',
		});
		expect(good.gzipBytes as number).toBeLessThan(good.bytes as number);

		const dead = rows.find((r) => r.service === 'dead')!;
		expect(dead.ok).toBe(false);
		expect(String(dead.error)).toMatch(/503/);

		// An entry with no URL yet is not a dead vendor — saying "invalid url"
		// would blame the vendor for work we have not done.
		const todo = rows.find((r) => r.service === 'unresearched')!;
		expect(todo.ok).toBe(false);
		expect(String(todo.error)).toMatch(/no spec url/i);
		expect(String(todo.error)).not.toMatch(/invalid/i);
	});

	it('renders a markdown table by default', async () => {
		const out = await run(['packs', 'audit']);
		expect(out).toMatch(/\| *service *\|/);
		expect(out).toMatch(/\| *good *\|/);
	});
});
