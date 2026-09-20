import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '../src/index.js';
import { loadGlobalConfig, loadProjectConfig, savePack } from 'integration-mock-core';

const run = async (args: string[]): Promise<string> => {
	const out: string[] = [];
	const p = buildProgram({ write: (s) => out.push(s) });
	await p.parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

describe('cli', () => {
	let cwd: string;

	beforeEach(() => {
		process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
		cwd = mkdtempSync(join(tmpdir(), 'proj-'));
		process.chdir(cwd);
	});

	it('registers every verb', () => {
		const names = buildProgram().commands.map((c) => c.name());
		for (const v of [
			'start',
			'stop',
			'status',
			'up',
			'down',
			'on',
			'off',
			'record',
			'ca',
			'url',
			'instances',
			'packs',
			'creds',
			'snapshot',
			'diff',
			'faults',
			'log',
		]) {
			expect(names).toContain(v);
		}
	});

	it('instances add/list/use', async () => {
		await run(['instances', 'add', 'dev', 'http://localhost:5678', 'key1']);
		await run(['instances', 'add', 'sb', 'http://sb', 'key2', '--default']);
		expect((await loadGlobalConfig()).defaultInstance).toBe('sb');
		await run(['instances', 'use', 'dev']);
		expect((await loadGlobalConfig()).defaultInstance).toBe('dev');
		expect(await run(['instances', 'list'])).toMatch(/\* dev\s+http:\/\/localhost:5678/);
	});

	it('packs list/enable/disable across layers', async () => {
		await savePack(join(process.env.INTEGRATION_MOCK_HOME!, 'packs', 'slack'), {
			id: 'slack',
			domains: ['slack.com'],
			prefix: '/slack',
			source: 'recorded',
			routes: [],
		});
		await savePack(join(cwd, '.integration-mock', 'packs', 'hub'), {
			id: 'hub',
			domains: ['hub.com'],
			prefix: '/hub',
			source: 'recorded',
			routes: [],
		});
		await run(['packs', 'enable', 'slack']);
		const listed = await run(['packs', 'list']);
		expect(listed).toMatch(/slack\s+user\s+enabled/);
		expect(listed).toMatch(/hub\s+project\s+disabled/);
		await run(['packs', 'disable', 'slack']);
		expect((await loadProjectConfig()).enabledPacks).toEqual([]);
	});

});
