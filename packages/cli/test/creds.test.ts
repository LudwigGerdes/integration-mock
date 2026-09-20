import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveGlobalConfig } from 'integration-mock-core';
import { registerCreds, type CredsClientFactory } from '../src/commands/creds.js';
import type { CredsClient } from '../src/commands/creds-fetch.js';

const schema = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		value: { type: 'string' },
		useCustomAuth: { type: 'notice' },
	},
};

interface Calls {
	created: Array<{ name: string; type: string; data: Record<string, unknown> }>;
	baseUrls: string[];
}

const fake = (calls: Calls): CredsClientFactory => (baseUrl) => {
	calls.baseUrls.push(baseUrl);
	const client: CredsClient = {
		schema: async () => schema,
		create: async (body) => {
			calls.created.push(body);
			return { id: 'cred-1', name: body.name };
		},
	};
	return client;
};

const run = async (args: string[], factory: CredsClientFactory): Promise<string> => {
	const out: string[] = [];
	const p = new Command('integration-mock').exitOverride();
	registerCreds(p, { write: (s) => out.push(s) }, factory);
	await p.parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

let calls: Calls;
beforeEach(async () => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	calls = { created: [], baseUrls: [] };
	await saveGlobalConfig({
		instances: [
			{ name: 'local', url: 'http://localhost:5678', apiKey: 'k1' },
			{ name: 'dev', url: 'https://dev.example', apiKey: 'k2' },
		],
		defaultInstance: 'local',
	});
});

describe('creds push', () => {
	it('creates a credential shaped by the type schema', async () => {
		const out = await run(['creds', 'push', 'httpHeaderAuth'], fake(calls));
		expect(calls.created).toEqual([
			{ name: 'httpHeaderAuth (mock)', type: 'httpHeaderAuth', data: { name: 'integration-mock', value: 'integration-mock' } },
		]);
		expect(out).toMatch(/created .* id cred-1/);
	});

	it('omits UI-only schema properties from the payload', async () => {
		await run(['creds', 'push', 'httpHeaderAuth'], fake(calls));
		expect(calls.created[0]?.data).not.toHaveProperty('useCustomAuth');
	});

	it('honours --field and --name', async () => {
		await run(
			['creds', 'push', 'httpHeaderAuth', '--name', 'Acme (mock)', '--field', 'value=secret'],
			fake(calls),
		);
		expect(calls.created[0]).toMatchObject({
			name: 'Acme (mock)',
			data: { name: 'integration-mock', value: 'secret' },
		});
	});

	it('creates nothing under --dry-run, but shows what it would send', async () => {
		const out = await run(['creds', 'push', 'httpHeaderAuth', '--dry-run'], fake(calls));
		expect(calls.created).toEqual([]);
		expect(out).toMatch(/would create/);
		expect(out).toMatch(/value = integration-mock/);
	});

	it('targets the default instance, and --instance overrides it', async () => {
		await run(['creds', 'push', 'httpHeaderAuth'], fake(calls));
		expect(calls.baseUrls).toEqual(['http://localhost:5678']);

		const c2: Calls = { created: [], baseUrls: [] };
		await run(['creds', 'push', 'httpHeaderAuth', '--instance', 'dev'], fake(c2));
		expect(c2.baseUrls).toEqual(['https://dev.example']);
	});

	it('says what to do when no instance is configured', async () => {
		await saveGlobalConfig({ instances: [] });
		await expect(run(['creds', 'push', 'httpHeaderAuth'], fake(calls))).rejects.toThrow(
			/no instance configured .*instances add/,
		);
	});

	it('names an unknown instance rather than silently using another', async () => {
		await expect(
			run(['creds', 'push', 'httpHeaderAuth', '--instance', 'nope'], fake(calls)),
		).rejects.toThrow(/no instance "nope"/);
	});

	it('emits machine-readable output', async () => {
		const j = JSON.parse(await run(['creds', 'push', 'httpHeaderAuth', '--json'], fake(calls))) as {
			id: string;
			instance: string;
		};
		expect(j).toMatchObject({ id: 'cred-1', instance: 'local' });
	});
});

describe('creds swap', () => {
	const workflow = {
		nodes: [
			{ name: 'Slack', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://slack.com/api/chat.postMessage' } },
			{ name: 'Dynamic', type: 'n8n-nodes-base.httpRequest', parameters: { url: '={{ $json.u }}' } },
		],
	};
	let wfPath: string;

	beforeEach(async () => {
		const { writeFile } = await import('node:fs/promises');
		wfPath = join(process.env.INTEGRATION_MOCK_HOME!, 'wf.json');
		await writeFile(wfPath, JSON.stringify(workflow));
	});

	it('previews without writing anything by default', async () => {
		const { readFile } = await import('node:fs/promises');
		const out = await run(
			['creds', 'swap', wfPath, '--base-url', 'http://127.0.0.1:8080'],
			fake(calls),
		);
		expect(out).toMatch(/Slack: https:\/\/slack\.com\/api\/chat\.postMessage -> http:\/\/127\.0\.0\.1:8080\/slack\//);
		expect(out).toMatch(/preview only/);
		expect(JSON.parse(await readFile(wfPath, 'utf8'))).toEqual(workflow);
	});

	it('reports an expression URL rather than guessing at it', async () => {
		const out = await run(['creds', 'swap', wfPath, '--base-url', 'http://127.0.0.1:8080'], fake(calls));
		expect(out).toMatch(/skipped Dynamic: expression URL/);
	});

	it('writes in place when asked, and round-trips back', async () => {
		const { readFile } = await import('node:fs/promises');
		await run(['creds', 'swap', wfPath, '--base-url', 'http://127.0.0.1:8080', '--in-place'], fake(calls));
		const mocked = JSON.parse(await readFile(wfPath, 'utf8')) as typeof workflow;
		expect(mocked.nodes[0]!.parameters.url).toBe('http://127.0.0.1:8080/slack/api/chat.postMessage');

		await run(
			['creds', 'swap', wfPath, '--base-url', 'http://127.0.0.1:8080', '--real', '--in-place'],
			fake(calls),
		);
		const back = JSON.parse(await readFile(wfPath, 'utf8')) as typeof workflow;
		expect(back.nodes[0]!.parameters.url).toBe('https://slack.com/api/chat.postMessage');
	});

	it('refuses contradictory directions', async () => {
		await expect(
			run(['creds', 'swap', wfPath, '--base-url', 'http://x', '--mock', '--real'], fake(calls)),
		).rejects.toThrow(/not both/);
	});
});

describe('creds swap --via proxy', () => {
	let wfPath2: string;
	beforeEach(async () => {
		const { writeFile } = await import('node:fs/promises');
		wfPath2 = join(process.env.INTEGRATION_MOCK_HOME!, 'wf2.json');
		await writeFile(wfPath2, JSON.stringify({
			nodes: [{ name: 'Slack', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://slack.com/api/x', options: {} } }],
		}));
	});

	it('sets the node proxy rather than rewriting the URL', async () => {
		const { readFile } = await import('node:fs/promises');
		await run(
			['creds', 'swap', wfPath2, '--base-url', 'http://mock.example:8080', '--via', 'proxy', '--in-place'],
			fake(calls),
		);
		const w = JSON.parse(await readFile(wfPath2, 'utf8')) as {
			nodes: Array<{ parameters: { url: string; options: Record<string, unknown> } }>;
		};
		expect(w.nodes[0]!.parameters.url).toBe('https://slack.com/api/x');
		expect(w.nodes[0]!.parameters.options).toEqual({
			proxy: 'http://mock.example:8080',
			allowUnauthorizedCerts: true,
		});
	});

	it('rejects an unknown --via', async () => {
		await expect(
			run(['creds', 'swap', wfPath2, '--base-url', 'http://x', '--via', 'telepathy'], fake(calls)),
		).rejects.toThrow(/must be "url" or "proxy"/);
	});
});
