import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ResourceStore, loadPack, resolve, type MockRequest, type Resolution } from 'integration-mock-core';
import { libraryPacksDir } from '../src/library.js';

const shipped = readdirSync(libraryPacksDir()).sort();

const serveFrom = async (service: string, req: Partial<MockRequest>): Promise<Resolution> => {
	const pack = await loadPack(join(libraryPacksDir(), service));
	return resolve(
		{ library: [pack], user: [], project: [], snapshot: [] },
		service,
		{ method: 'GET', host: '', path: '/', query: {}, headers: {}, ...req },
		new ResourceStore(pack.seed),
	);
};

describe('shipped packs', () => {
	it('ships the vendors the audit found usable', () => {
		expect(shipped.length).toBeGreaterThanOrEqual(14);
		expect(shipped).toContain('generic-rest');
	});

	// Data-driven rather than hand-picked: every pack must serve its own first
	// route, so a vendor whose spec changes shape fails here rather than silently
	// shipping something that matches nothing.
	for (const service of shipped) {
		if (service === 'generic-rest') continue;
		it(`${service} loads and serves its first route`, async () => {
			const pack = await loadPack(join(libraryPacksDir(), service));
			expect(pack.domains.length).toBeGreaterThan(0);
			expect(pack.routes.length).toBeGreaterThan(0);

			const first = pack.routes[0]!;
			const res = await serveFrom(service, {
				method: first.match.method === '*' ? 'GET' : first.match.method,
				path: first.match.path.replace(/:[^/]+/g, 'x'),
				query: first.match.query ?? {},
			});
			expect(res.matched).not.toBe('unmatched');
			expect(res.status).toBeGreaterThanOrEqual(200);
		});
	}

	it('slack serves chat.postMessage', async () => {
		const res = await serveFrom('slack', { method: 'POST', path: '/api/chat.postMessage' });
		expect(res.matched).not.toBe('unmatched');
	});

	it('generic-rest serves CRUD from its seed for an unknown vendor', async () => {
		const list = await serveFrom('generic-rest', { path: '/contacts' });
		expect((list.body as { data: unknown[] }).data).toHaveLength(2);
		const one = await serveFrom('generic-rest', { path: '/contacts/contact-1' });
		expect((one.body as { email: string }).email).toBe('ada@example.com');
	});
});
