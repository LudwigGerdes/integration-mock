import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPack, savePack, loadLayer, USER_PACKS_DIR, projectPacksDir } from '../src/pack-io.js';
import type { ServicePack } from '../src/types.js';

const pack: ServicePack = {
	id: 'slack',
	domains: ['slack.com'],
	prefix: '/slack',
	source: 'recorded',
	routes: [{ id: 'a', match: { method: 'GET', path: '/x' }, respond: { status: 200, body: 1 } }],
};

describe('pack-io', () => {
	it('round-trips a pack', async () => {
		const dir = join(mkdtempSync(join(tmpdir(), 'pk-')), 'slack');
		await savePack(dir, pack);
		expect(await loadPack(dir)).toEqual(pack);
	});

	it('merges multiple route files in name order', async () => {
		const dir = join(mkdtempSync(join(tmpdir(), 'pk-')), 'p');
		mkdirSync(join(dir, 'routes'), { recursive: true });
		writeFileSync(
			join(dir, 'pack.json'),
			JSON.stringify({ id: 'p', domains: ['p.com'], prefix: '/p', source: 'library' }),
		);
		writeFileSync(
			join(dir, 'routes', 'b.json'),
			JSON.stringify([{ id: 'b', match: { method: 'GET', path: '/b' } }]),
		);
		writeFileSync(
			join(dir, 'routes', 'a.json'),
			JSON.stringify([{ id: 'a', match: { method: 'GET', path: '/a' } }]),
		);
		expect((await loadPack(dir)).routes.map((r) => r.id)).toEqual(['a', 'b']);
	});

	it('loadLayer lists packs, tolerates missing dir', async () => {
		const root = mkdtempSync(join(tmpdir(), 'layer-'));
		await savePack(join(root, 'slack'), pack);
		await savePack(join(root, 'hub'), { ...pack, id: 'hub', prefix: '/hub', domains: ['hub.com'] });
		mkdirSync(join(root, 'not-a-pack'));
		expect((await loadLayer(root)).map((p) => p.id).sort()).toEqual(['hub', 'slack']);
		expect(await loadLayer(join(root, 'nope'))).toEqual([]);
	});

	it('rejects invalid pack.json', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bad-'));
		writeFileSync(join(dir, 'pack.json'), JSON.stringify({ id: 'x' }));
		await expect(loadPack(dir)).rejects.toThrow(/invalid pack/);
	});

	it('exports dirs', () => {
		expect(USER_PACKS_DIR.endsWith('/.integration-mock/packs')).toBe(true);
		expect(projectPacksDir('/tmp/x')).toBe('/tmp/x/.integration-mock/packs');
	});
});

it('skips an entry that vanishes mid-scan rather than failing the layer', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'layer-'));
	await savePack(join(dir, 'real'), {
		id: 'real',
		domains: ['a.test'],
		prefix: '/real',
		source: 'recorded',
		routes: [],
	});
	// A dangling symlink reproduces the race deterministically: readdir lists
	// it, stat then fails with ENOENT — exactly what happens when a pack is
	// deleted between the two calls.
	symlinkSync(join(dir, 'gone'), join(dir, 'ghost'));

	const packs = await loadLayer(dir);
	expect(packs.map((p) => p.id)).toEqual(['real']);
});

it('round-trips an authored pack', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'authored-')), 'acme');
	await savePack(dir, {
		id: 'acme',
		domains: ['api.acme.test'],
		prefix: '/acme',
		source: 'authored',
		routes: [],
	});
	expect((await loadPack(dir)).source).toBe('authored');
});

describe('route files: an earlier file replaces what it overrides', () => {
	const write = (files: Record<string, unknown[]>) => {
		const dir = join(mkdtempSync(join(tmpdir(), 'pk-')), 'acme');
		mkdirSync(join(dir, 'routes'), { recursive: true });
		writeFileSync(join(dir, 'pack.json'), JSON.stringify({ id: 'acme', domains: ['acme.test'], prefix: '/acme', source: 'openapi' }));
		for (const [name, routes] of Object.entries(files)) writeFileSync(join(dir, 'routes', name), JSON.stringify(routes));
		return dir;
	};
	const route = (id: string, method: string, path: string, extra: Record<string, unknown> = {}) => ({
		id,
		match: { method, path, ...extra },
		respond: { status: 200 },
	});

	it('drops a later route with the same method and path shape, param names aside', async () => {
		const dir = write({
			'00-overrides.json': [route('mine', 'GET', '/things/:id')],
			'10-generated.json': [route('gen-get', 'GET', '/things/:thingId'), route('gen-list', 'GET', '/things'), route('gen-post', 'POST', '/things/:thingId')],
		});
		expect((await loadPack(dir)).routes.map((r) => r.id)).toEqual(['mine', 'gen-list', 'gen-post']);
	});

	it('keeps a later route when the earlier one is narrower (query or body matcher)', async () => {
		const dir = write({
			'00-overrides.json': [route('narrow', 'GET', '/things', { query: { q: 'x' } })],
			'10-generated.json': [route('gen-list', 'GET', '/things')],
		});
		expect((await loadPack(dir)).routes.map((r) => r.id)).toEqual(['narrow', 'gen-list']);
	});

	it('never drops routes within one file', async () => {
		const dir = write({ 'main.json': [route('a', 'GET', '/x/:id'), route('b', 'GET', '/x/:other')] });
		expect((await loadPack(dir)).routes.map((r) => r.id)).toEqual(['a', 'b']);
	});
});
