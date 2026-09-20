import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPack, validatePack } from 'integration-mock-core';
import { buildProgram } from '../src/index.js';

const run = async (args: string[]): Promise<string> => {
	const out: string[] = [];
	await buildProgram({ write: (s) => out.push(s) }).parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

let cwd: string;
beforeEach(() => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	cwd = mkdtempSync(join(tmpdir(), 'proj-'));
	process.chdir(cwd);
});

describe('packs init', () => {
	it('scaffolds a pack that validates immediately', async () => {
		await run(['packs', 'init', 'acme', '--domain', 'api.acme.test']);
		const pack = await loadPack(join(cwd, '.integration-mock', 'packs', 'acme'));
		expect(pack).toMatchObject({
			id: 'acme',
			domains: ['api.acme.test'],
			prefix: '/acme',
			source: 'authored',
		});
		// A scaffold that reports problems it did not cause would train the
		// agent to ignore the validator on its very first run.
		expect(validatePack(pack).filter((p) => p.level === 'error')).toEqual([]);
	});

	it('honours an explicit prefix', async () => {
		await run(['packs', 'init', 'acme', '--domain', 'api.acme.test', '--prefix', '/vendor/acme']);
		expect((await loadPack(join(cwd, '.integration-mock', 'packs', 'acme'))).prefix).toBe('/vendor/acme');
	});

	it('refuses to overwrite an existing pack', async () => {
		await run(['packs', 'init', 'acme', '--domain', 'api.acme.test']);
		await expect(
			run(['packs', 'init', 'acme', '--domain', 'api.acme.test']),
		).rejects.toThrow(/already exists/);
	});
});

it('accepts several domains, as a vendor spanning hosts needs', async () => {
	// Salesforce is the motivating case: auth on login.salesforce.com, data on
	// the org's own subdomain.
	await run([
		'packs', 'init', 'sf',
		'--domain', 'login.salesforce.com',
		'--domain', '*.my.salesforce.com',
	]);
	expect((await loadPack(join(cwd, '.integration-mock', 'packs', 'sf'))).domains).toEqual([
		'login.salesforce.com',
		'*.my.salesforce.com',
	]);
});
