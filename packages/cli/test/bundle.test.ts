import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The built binary, not the source: these are the flows the fresh-clone user
 * test ran, and two of its bugs lived only in the bundle (libraryPacksDir()
 * resolving relative to dist/bin.js) or only in a running daemon (pack layers
 * read once at boot). Skipped when `pnpm build` has not run.
 */
const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const built = existsSync(BIN);

let home: string;
let cwd: string;
const env = (): NodeJS.ProcessEnv => ({ ...process.env, INTEGRATION_MOCK_HOME: home });

const cli = (...args: string[]): { out: string; code: number } => {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(), encoding: 'utf8' });
	return { out: (r.stdout + r.stderr).trim(), code: r.status ?? -1 };
};

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), 'integration-mock-home-'));
	cwd = mkdtempSync(join(tmpdir(), 'integration-mock-proj-'));
});

describe.skipIf(!built)('bundled CLI against the checkout', () => {
	it('sees the whole library, not just the prepack core set', () => {
		const { out } = cli('packs', 'list', '--installed');
		expect(out).toMatch(/^stripe\tlibrary\t/m);
		expect(out).not.toMatch(/\tavailable\t/);
	});

	it('ejects a shipped pack into the project layer', () => {
		const { out, code } = cli('packs', 'eject', 'stripe');
		expect(code).toBe(0);
		expect(out).toMatch(/^ejected stripe/);
		expect(existsSync(join(cwd, '.integration-mock', 'packs', 'stripe', 'pack.json'))).toBe(true);
	});

	it('tells the user how to build a vendor whose spec is not vendored', () => {
		const { out, code } = cli('packs', 'build', 'stripe');
		expect(code).toBe(1);
		expect(out).toMatch(/integration-mock packs build stripe --fetch/);
		expect(out).not.toMatch(/add it to sources\.yaml/);
	});
});

describe.skipIf(!built)('a running daemon picks up a pack authored after start', () => {
	let port = 0;

	beforeAll(() => {
		const r = cli('start', '--port', '0', '--admin-port', '0');
		expect(r.code, r.out).toBe(0);
		port = (JSON.parse(readFileSync(join(home, 'proxy.json'), 'utf8')) as { port: number }).port;
	}, 20_000);

	afterAll(() => {
		cli('stop');
	});

	it('init → enable → url → curl, no restart', async () => {
		expect(cli('packs', 'init', 'acme', '--domain', 'api.acme.test').code).toBe(0);
		expect(cli('packs', 'enable', 'acme').out).toBe('enabled: acme');
		expect(cli('url', 'acme').out).toBe(`http://127.0.0.1:${port}/acme`);
		const res = await fetch(`http://127.0.0.1:${port}/acme/example`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ replace: 'me' });
	});
});
