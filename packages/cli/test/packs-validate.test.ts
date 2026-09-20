import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePack } from 'integration-mock-core';
import { buildProgram } from '../src/index.js';

/**
 * `validate` writes its report and THEN throws, so a non-zero exit reaches CI.
 * Tests inspecting the report of a failing pack must capture output across that
 * rejection — awaiting parseAsync alone would lose the JSON it just wrote.
 */
const runCapturing = async (args: string[]): Promise<string> => {
	const out: string[] = [];
	await buildProgram({ write: (s) => out.push(s) })
		.parseAsync(['node', 'integration-mock', ...args])
		.catch(() => undefined);
	return out.join('\n');
};

let cwd: string;
beforeEach(() => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	cwd = mkdtempSync(join(tmpdir(), 'proj-'));
	process.chdir(cwd);
});

describe('packs validate', () => {
	it('reports a clean pack', async () => {
		await savePack(join(cwd, '.integration-mock', 'packs', 'acme'), {
			id: 'acme',
			domains: ['api.acme.test'],
			prefix: '/acme',
			source: 'authored',
			routes: [
				{ id: 'ok', match: { method: 'GET', path: '/x' }, respond: { status: 200, body: {} } },
				{ id: 'bad', match: { method: 'GET', path: '/y' }, respond: { status: 404, body: {} } },
			],
		});
		expect(await runCapturing(['packs', 'validate', 'acme'])).toMatch(/no problems/i);
	});

	it('emits machine-readable problems for the authoring loop', async () => {
		await savePack(join(cwd, '.integration-mock', 'packs', 'acme'), {
			id: 'acme',
			domains: ['api.acme.test'],
			prefix: '/acme',
			source: 'authored',
			routes: [
				{ id: 'a', match: { method: 'GET', path: '/x' }, respond: { status: 200 } },
				{ id: 'b', match: { method: 'GET', path: '/x' }, respond: { status: 200 } },
			],
		});
		const rows = JSON.parse(
			await runCapturing(['packs', 'validate', 'acme', '--json']),
		) as Array<{ code: string; level: string }>;
		expect(rows.map((r) => r.code)).toContain('shadowed-route');
		expect(rows.find((r) => r.code === 'shadowed-route')?.level).toBe('error');
	});

	it('exits non-zero when a pack has errors', async () => {
		await savePack(join(cwd, '.integration-mock', 'packs', 'acme'), {
			id: 'acme',
			domains: ['api.acme.test'],
			prefix: '/acme',
			source: 'authored',
			routes: [
				{ id: 'a', match: { method: 'GET', path: '/x' }, respond: { status: 200 } },
				{ id: 'a', match: { method: 'GET', path: '/y' }, respond: { status: 500 } },
			],
		});
		await expect(
			buildProgram({ write: () => undefined }).parseAsync(['node', 'integration-mock', 'packs', 'validate', 'acme']),
		).rejects.toThrow(/error/i);
	});
});
