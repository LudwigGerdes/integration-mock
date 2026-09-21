import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import { RequestLog, FaultController, redact, saveGlobalConfig } from 'integration-mock-core';
import { MockEngine, startAdmin } from 'integration-mock-proxy';
import { buildProgram } from '../src/index.js';
import { setDispatcherForTests } from '../src/commands/snapshot.js';

const basic = JSON.parse(
	readFileSync(new URL('../../core/test/fixtures/execution-basic.json', import.meta.url), 'utf8'),
) as {
	data: { resultData: { runData: Record<string, Array<{ data?: { main?: Array<Array<{ json: Record<string, unknown> }>> } }>> } };
};
// A real execution export carries live response bodies; give this one a token
// so the redaction path is actually exercised rather than assumed.
basic.data.resultData.runData['Fetch Users']![0]!.data!.main![0]![0]!.json.token =
	'xoxb-0123456789abcdefghijk';
const edited: unknown = JSON.parse(
	readFileSync(new URL('../../core/test/fixtures/execution-edited.json', import.meta.url), 'utf8'),
);

let admin: Awaited<ReturnType<typeof startAdmin>>;
let engine: MockEngine;
let cwd: string;

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
	const a = new MockAgent();
	a.disableNetConnect();
	const pool = a.get('http://n8n.test');
	pool
		.intercept({ path: '/api/v1/executions/4123?includeData=true', method: 'GET' })
		.reply(200, basic)
		.persist();
	pool
		.intercept({ path: '/api/v1/executions?limit=1&workflowId=8f3a', method: 'GET' })
		.reply(200, { data: [{ id: '4130' }] })
		.persist();
	pool
		.intercept({ path: '/api/v1/executions/4130?includeData=true', method: 'GET' })
		.reply(200, edited)
		.persist();
	setDispatcherForTests(a);
});

afterAll(() => admin.close());

beforeEach(async () => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	cwd = mkdtempSync(join(tmpdir(), 'proj-'));
	process.chdir(cwd);
	writeFileSync(
		join(process.env.INTEGRATION_MOCK_HOME, 'proxy.json'),
		JSON.stringify({ port: 1, adminPort: admin.port, pid: 0 }),
	);
	await saveGlobalConfig({
		instances: [{ name: 'dev', url: 'http://n8n.test', apiKey: 'k' }],
		defaultInstance: 'dev',
	});
});

describe('snapshot cli', () => {
	it('snapshot writes file, gitignores, activates, prints summary', async () => {
		const out = await run(['snapshot', '4123']);
		expect(existsSync(join(cwd, '.integration-mock', 'snapshots', '8f3a', '4123.json'))).toBe(true);
		expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('.integration-mock/snapshots/');
		expect(engine.state().mode).toBe('replay');
		expect(engine.state().enabledPacks).toContain('api-example-com');
		expect(out).toMatch(/api-example-com\s+1\s+api\.example\.com/);
		expect(out).toContain('Retry the workflow from anywhere');
	});

	it('writes the raw execution export beside the snapshot (seam S4)', async () => {
		await run(['snapshot', '4123']);
		const exportPath = join(cwd, '.integration-mock', 'snapshots', '8f3a', '4123.export.json');
		expect(existsSync(exportPath)).toBe(true);
		// The API's own payload, redacted: canvas and workflow-test consume this shape,
		// and a derived snapshot is not an interchange format.
		expect(JSON.parse(readFileSync(exportPath, 'utf8'))).toEqual(redact(basic));
	});

	it('redacts the raw export too — --commit would otherwise put secrets in git', async () => {
		await run(['snapshot', '4123']);
		const raw = readFileSync(
			join(cwd, '.integration-mock', 'snapshots', '8f3a', '4123.export.json'),
			'utf8',
		);
		// The fixture's Fetch Users output carries a token-shaped string.
		expect(raw).not.toContain('xoxb-0123456789abcdefghijk');
		expect(raw).toContain('[REDACTED]');
		// Structure must survive: S4 consumers need a faithful execution document.
		const doc = JSON.parse(raw) as { workflowData: { name: string }; status: string };
		expect(doc.workflowData.name).toBe('Users to Slack');
		expect(doc.status).toBe('success');
	});

	it('diff against latest', async () => {
		await run(['snapshot', '4123']);
		engine.logRef.append({
			service: 'api-example-com',
			method: 'GET',
			url: 'u',
			path: '/users',
			query: { page: '2' },
			reqHeaders: {},
			status: 501,
			resHeaders: {},
			latencyMs: 1,
			matchedRoute: 'unmatched',
		});
		const out = await run(['diff']);
		expect(out).toMatch(/Changed nodes[\s\S]*Fetch Users[\s\S]*Pick Fields/);
		expect(out).toMatch(/unmatched[\s\S]*GET \/users/);
		expect(out).toMatch(/missing[\s\S]*api-example-com:GET:\/users#0/);
		const j = JSON.parse(await run(['diff', '--json'])) as { changedNodes: string[] };
		expect(j.changedNodes).toContain('Fetch Users');
	});

	it('diff without snapshot errors', async () => {
		engine.activateSnapshot(undefined);
		await expect(run(['diff'])).rejects.toThrow(/no active snapshot/);
	});
});
