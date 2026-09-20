import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore, loadPack, resolve, type ServicePack } from 'integration-mock-core';
import { saveGeneratedRoutes } from '../src/write.js';

const pack = (body: string): ServicePack => ({
	id: 'demo',
	domains: ['api.demo.test'],
	prefix: '/demo',
	source: 'openapi',
	routes: [
		{ id: 'demo:GET:/x#0', match: { method: 'GET', path: '/x' }, respond: { status: 200, body } },
	],
});

describe('saveGeneratedRoutes', () => {
	it('keeps hand-tuned overrides and lets them win over regenerated routes', async () => {
		const dir = join(mkdtempSync(join(tmpdir(), 'pack-')), 'demo');
		await saveGeneratedRoutes(dir, pack('generated'));
		await mkdir(join(dir, 'routes'), { recursive: true });
		await writeFile(
			join(dir, 'routes', '00-overrides.json'),
			JSON.stringify([
				{
					id: 'demo:GET:/x#override',
					match: { method: 'GET', path: '/x' },
					respond: { status: 200, body: 'hand-tuned' },
				},
			]),
		);

		// Regenerate: the override file must survive untouched and still win.
		await saveGeneratedRoutes(dir, pack('regenerated'));
		expect(existsSync(join(dir, 'routes', '00-overrides.json'))).toBe(true);

		const loaded = await loadPack(dir);
		const res = resolve(
			{ library: [loaded], user: [], project: [], snapshot: [] },
			'demo',
			{ method: 'GET', host: '', path: '/x', query: {}, headers: {} },
			new ResourceStore(),
		);
		expect(res.body).toBe('hand-tuned');
	});

	it('removes a stale main.json so routes are not served twice', async () => {
		const dir = join(mkdtempSync(join(tmpdir(), 'pack-')), 'demo');
		await mkdir(join(dir, 'routes'), { recursive: true });
		await writeFile(join(dir, 'routes', 'main.json'), JSON.stringify(pack('old').routes));
		await saveGeneratedRoutes(dir, pack('new'));
		expect(existsSync(join(dir, 'routes', 'main.json'))).toBe(false);
		expect((await loadPack(dir)).routes).toHaveLength(1);
	});
});
