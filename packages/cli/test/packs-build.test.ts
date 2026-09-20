import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPack } from 'integration-mock-core';
import { libraryPacksDir } from 'integration-mock-packs';
import { buildProgram } from '../src/index.js';

const run = async (args: string[]): Promise<string> => {
	const out: string[] = [];
	await buildProgram({ write: (s) => out.push(s) }).parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

let cwd: string;

beforeEach(async () => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	cwd = mkdtempSync(join(tmpdir(), 'proj-'));
	process.chdir(cwd);
	// The library dir lives inside the package, so a build here is a real write.
	await rm(join(libraryPacksDir(), 'demo'), { recursive: true, force: true });
});

// Leave nothing behind: an uncleaned pack would be committed as test detritus.
afterEach(async () => {
	await rm(join(libraryPacksDir(), 'demo'), { recursive: true, force: true });
});

describe('packs build', () => {
	it('builds from a local spec and reports', async () => {
		const spec = join(cwd, 'api.json');
		await writeFile(
			spec,
			JSON.stringify({
				openapi: '3.0.0',
				servers: [{ url: 'https://api.demo.test' }],
				paths: {
					'/things': {
						get: { responses: { '200': { content: { 'application/json': { example: [{ id: 1 }] } } } } },
					},
				},
			}),
		);
		const out = await run(['packs', 'build', 'demo', '--spec', spec]);
		expect(out).toMatch(/routes\s+1/);
		const pack = await loadPack(join(libraryPacksDir(), 'demo'));
		expect(pack.domains).toEqual(['api.demo.test']);
		expect(pack.routes[0]!.match.path).toBe('/things');
	});

	it('errors clearly with no spec available', async () => {
		await expect(run(['packs', 'build', 'nosuchvendor'])).rejects.toThrow(/no spec for nosuchvendor/);
	});

	it('eject copies the library pack into the project layer and refuses to clobber', async () => {
		const spec = join(cwd, 'api.json');
		await writeFile(
			spec,
			JSON.stringify({ openapi: '3.0.0', servers: [{ url: 'https://api.demo.test' }], paths: {} }),
		);
		await run(['packs', 'build', 'demo', '--spec', spec]);
		await run(['packs', 'eject', 'demo']);
		expect(existsSync(join(cwd, '.integration-mock', 'packs', 'demo', 'pack.json'))).toBe(true);
		await expect(run(['packs', 'eject', 'demo'])).rejects.toThrow(/already exists/);
	});
});
