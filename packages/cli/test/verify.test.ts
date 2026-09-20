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
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test'], ok);
		expect(out).toMatch(/invented items\[\]\.Guessed/);
		expect(out).toMatch(/pack invented/);
	});

	it('skips write methods by default and says how to include them', async () => {
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test'], ok);
		expect(out).toMatch(/skipped.*create: POST has side effects.*--unsafe/s);
	});

	it('skips a route whose path needs a parameter, naming the remedy', async () => {
		const out = await run(['verify', 'acme', '--base-url', 'https://api.acme.test'], ok);
		expect(out).toMatch(/byId: cannot build a concrete request.*--param/s);
	});

	it('fills a parameter when given one', async () => {
		const seen: string[] = [];
		const spy: Fetcher = async (r) => {
			seen.push(r.url);
			return { status: 200, body: { id: 'real' } };
		};
		await run(
			['verify', 'acme', '--base-url', 'https://api.acme.test', '--param', 'id=123'],
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
			['verify', 'acme', '--base-url', 'https://api.acme.test', '--header', 'Authorization: Bearer t'],
			spy,
		);
		expect(got.Authorization).toBe('Bearer t');
	});

	it('emits machine-readable findings', async () => {
		const rows = JSON.parse(
			await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--json'], ok),
		) as Array<{ kind: string }>;
		expect(rows.map((r) => r.kind)).toContain('shape');
	});

	it('patches bodies from reality and leaves matchers alone', async () => {
		await run(['verify', 'acme', '--base-url', 'https://api.acme.test', '--patch'], ok);
		const after = await loadPack(join(cwd, '.integration-mock', 'packs', 'acme'));
		const list = after.routes.find((r) => r.id === 'list')!;
		expect(list.respond?.body).toEqual({ items: [{ id: 'real' }] });
		expect(list.match).toEqual({ method: 'GET', path: '/things' });
		// A skipped route must survive untouched.
		expect(after.routes.find((r) => r.id === 'create')?.respond?.body).toEqual({ id: 'a' });
	});

	it('reports an unreachable vendor', async () => {
		const dead: Fetcher = async () => ({ error: 'ENOTFOUND api.acme.test' });
		expect(await run(['verify', 'acme', '--base-url', 'https://api.acme.test'], dead)).toMatch(
			/unreachable.*ENOTFOUND/s,
		);
	});
});
