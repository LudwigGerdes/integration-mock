import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPack, savePack, type ServicePack } from 'integration-mock-core';
import { registerVerify } from '../src/commands/verify.js';
import type { Fetcher } from '../src/commands/verify-fetch.js';

const run = async (args: string[], fetcher: Fetcher): Promise<string> => {
	const out: string[] = [];
	const p = new Command('integration-mock').exitOverride();
	registerVerify(p, { write: (s) => out.push(s) }, fetcher);
	await p.parseAsync(['node', 'integration-mock', ...args]);
	return out.join('\n');
};

/** Like run, but for the failing case: the report and the error separately. */
const runFailing = async (args: string[], fetcher: Fetcher): Promise<{ out: string; error: Error & { exitCode?: number } }> => {
	const out: string[] = [];
	const p = new Command('integration-mock').exitOverride();
	registerVerify(p, { write: (s) => out.push(s) }, fetcher);
	const error = await p.parseAsync(['node', 'integration-mock', ...args]).then(
		() => { throw new Error('expected verify to fail'); },
		(e: unknown) => e as Error & { exitCode?: number },
	);
	return { out: out.join('\n'), error };
};

let cwd: string;
const pack: ServicePack = {
	id: 'acme',
	domains: ['api.acme.test'],
	prefix: '/acme',
	source: 'authored',
	routes: [
		{
			id: 'list',
			match: { method: 'GET', path: '/things' },
			respond: { status: 200, body: { items: [{ id: 'a', Guessed: true }] } },
		},
		{
			id: 'create',
			match: { method: 'POST', path: '/things' },
			respond: { status: 201, body: { id: 'a' } },
		},
		{
			id: 'byId',
			match: { method: 'GET', path: '/things/:id' },
			respond: { status: 200, body: { id: 'a' } },
		},
	],
};

beforeEach(async () => {
	process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	cwd = mkdtempSync(join(tmpdir(), 'proj-'));
	process.chdir(cwd);
	await savePack(join(cwd, '.integration-mock', 'packs', 'acme'), pack);
});

const ok: Fetcher = async () => ({ status: 200, body: { items: [{ id: 'real' }] } });

describe('verify', () => {
	it('reports a field the pack invented', async () => {
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--fail-on', 'none'], ok);
		expect(out).toMatch(/invented items\[\]\.Guessed/);
		expect(out).toMatch(/pack invented/);
	});

	it('skips write methods by default and says how to include them', async () => {
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--fail-on', 'none'], ok);
		expect(out).toMatch(/skipped.*create: POST has side effects.*--unsafe/s);
	});

	it('skips a route whose path needs a parameter, naming the remedy', async () => {
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--fail-on', 'none'], ok);
		expect(out).toMatch(/byId: cannot build a concrete request.*--param/s);
	});

	it('fills a parameter when given one', async () => {
		const seen: string[] = [];
		const spy: Fetcher = async (r) => {
			seen.push(r.url);
			return { status: 200, body: { id: 'real' } };
		};
		await run(
			['verify', 'acme', '--base-url', 'https://api.acme.test', '--param', 'id=123', '--fail-on', 'none'],
			spy,
		);
		expect(seen).toContain('https://api.acme.test/things/123');
	});

	it('passes headers through', async () => {
		let got: Record<string, string> = {};
		const spy: Fetcher = async (r) => {
			got = r.headers;
			return { status: 200, body: { items: [{ id: 'r' }] } };
		};
		await run(
			['verify', 'acme', '--base-url', 'https://api.acme.test', '--header', 'Authorization: Bearer t', '--fail-on', 'none'],
			spy,
		);
		expect(got.Authorization).toBe('Bearer t');
	});

	it('emits machine-readable findings', async () => {
		const rows = JSON.parse(
			await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--json', '--fail-on', 'none'], ok),
		) as Array<{ kind: string }>;
		expect(rows.map((r) => r.kind)).toContain('shape');
	});

	it('patches bodies from reality and leaves matchers alone', async () => {
		await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--patch', '--fail-on', 'none'], ok);
		const after = await loadPack(join(cwd, '.integration-mock', 'packs', 'acme'));
		const list = after.routes.find((r) => r.id === 'list')!;
		expect(list.respond?.body).toEqual({ items: [{ id: 'real' }] });
		expect(list.match).toEqual({ method: 'GET', path: '/things' });
		// A skipped route must survive untouched.
		expect(after.routes.find((r) => r.id === 'create')?.respond?.body).toEqual({ id: 'a' });
	});

	it('--patch never writes a credential the vendor returned', async () => {
		const leaky: Fetcher = async () => ({
			status: 200,
			body: { items: [{ id: 'real' }], access_token: 'sk_live_0123456789abcdefghijkl', authorization: 'x' },
		});
		await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--patch', '--fail-on', 'none'], leaky);
		const after = await loadPack(join(cwd, '.integration-mock', 'packs', 'acme'));
		const body = after.routes.find((r) => r.id === 'list')!.respond!.body as Record<string, unknown>;
		expect(body.access_token).toBe('[REDACTED]');
		expect(body.authorization).toBe('[REDACTED]');
		expect(body.items).toEqual([{ id: 'real' }]);
	});

	it('exits 1 on a difference, so drift is a red build, after printing the report', async () => {
		const { out, error } = await runFailing(['verify', 'acme', '--base-url', 'https://api.acme.test'], ok);
		expect(out).toMatch(/invented items\[\]\.Guessed/);
		expect(error.exitCode).toBe(1);
		expect(error.message).toMatch(/1 difference/);
	});

	it('exits 0 when the only findings are skipped routes', async () => {
		const all: Fetcher = async () => ({ status: 200, body: { items: [{ id: 'a', Guessed: true }] } });
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test'], all);
		expect(out).toMatch(/skipped/);
	});

	it('--fail-on names the kinds that fail; "none" reports only', async () => {
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--fail-on', 'none'], ok);
		expect(out).toMatch(/invented/);
		await expect(
			run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--fail-on', 'unreachable'], ok),
		).resolves.toMatch(/invented/);
		await expect(
			run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--fail-on', 'bogus'], ok),
		).rejects.toThrow(/--fail-on/);
	});

	it('reports an unreachable vendor, and that fails too', async () => {
		const dead: Fetcher = async () => ({ error: 'ENOTFOUND api.acme.test' });
		const { out, error } = await runFailing(['verify', 'acme', '--base-url', 'https://api.acme.test'], dead);
		expect(out).toMatch(/unreachable.*ENOTFOUND/s);
		expect(error.exitCode).toBe(1);
	});
});
