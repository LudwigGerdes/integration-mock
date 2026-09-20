import { describe, it, expect } from 'vitest';
import type { ServicePack } from 'integration-mock-core';
import { mergePacks } from '../src/merge.js';

const pack = (id: string, domain: string, paths: Array<[string, string]>): ServicePack => ({
	id,
	domains: [domain],
	prefix: `/${id}`,
	source: 'openapi',
	routes: paths.map(([method, path]) => ({
		id: `${id}:${method}:${path}#0`,
		match: { method: method as 'GET', path },
		respond: { status: 200, body: { from: path } },
	})),
});

describe('mergePacks', () => {
	it('unions domains and concatenates routes', () => {
		const { pack: merged } = mergePacks('hubspot', [
			pack('a', 'api.hubapi.com', [['GET', '/contacts']]),
			pack('b', 'api.hubapi.com', [['GET', '/deals']]),
		]);
		expect(merged.id).toBe('hubspot');
		expect(merged.domains).toEqual(['api.hubapi.com']);
		expect(merged.routes.map((r) => r.match.path)).toEqual(['/contacts', '/deals']);
	});

	it('drops a duplicate method+path and counts it', () => {
		const { pack: merged, duplicates } = mergePacks('hubspot', [
			pack('a', 'h.test', [['GET', '/shared']]),
			pack('b', 'h.test', [['GET', '/shared'], ['GET', '/unique']]),
		]);
		// First wins, because vendors repeat common endpoints across their specs
		// and a second copy would shadow nothing useful.
		expect(merged.routes).toHaveLength(2);
		expect((merged.routes[0]!.respond!.body as { from: string }).from).toBe('/shared');
		expect(duplicates).toBe(1);
	});

	it('keeps distinct domains from different specs', () => {
		const { pack: merged } = mergePacks('x', [
			pack('a', 'one.test', [['GET', '/a']]),
			pack('b', 'two.test', [['GET', '/b']]),
		]);
		expect(merged.domains.sort()).toEqual(['one.test', 'two.test']);
	});
});
