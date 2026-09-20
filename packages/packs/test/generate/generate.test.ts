import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	ResourceStore,
	resolve,
	type MockRequest,
	type Resolution,
	type ServicePack,
} from 'integration-mock-core';
import { generatePack, openApiPathToMatch } from '../../src/generate/generate.js';
import type { OpenApiDoc } from '../../src/generate/openapi.js';

const load = (n: string): OpenApiDoc =>
	JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), 'utf8')) as OpenApiDoc;

const serve = (pack: ServicePack, req: Partial<MockRequest>): Resolution =>
	resolve(
		{ library: [pack], user: [], project: [], snapshot: [] },
		pack.id,
		{ method: 'GET', host: '', path: '/', query: {}, headers: {}, ...req },
		new ResourceStore(),
	);

describe('openApiPathToMatch', () => {
	it('converts braces to matcher params', () => {
		expect(openApiPathToMatch('/users/{id}/posts/{postId}')).toBe('/users/:id/posts/:postId');
		expect(openApiPathToMatch('/plain')).toBe('/plain');
	});
});

describe('generatePack', () => {
	it('derives domains, prefixes routes with the server path, and serves', () => {
		const { pack, report } = generatePack(load('petstore'), { id: 'petstore' });
		expect(pack.domains).toEqual(['api.petstore.test']);
		expect(pack.prefix).toBe('/petstore');
		expect(pack.source).toBe('openapi');
		expect(report.routes).toBe(3);

		const list = serve(pack, { path: '/v1/pets' });
		expect(list.status).toBe(200);
		expect((list.body as Array<{ name: string }>)[0]!.name).toBe('Rex');

		const created = serve(pack, { method: 'POST', path: '/v1/pets' });
		expect(created.status).toBe(201);

		const one = serve(pack, { path: '/v1/pets/7' });
		expect(one.body).toEqual({ id: 7, name: 'Fido' });
	});

	it('skips deprecated operations and reports them', () => {
		const { report } = generatePack(load('petstore'), { id: 'petstore' });
		expect(report.skipped).toEqual([
			{ path: '/pets/{petId}', method: 'DELETE', reason: 'deprecated' },
		]);
	});

	it('degrades on partial specs without throwing', () => {
		const { pack, report } = generatePack(load('partial'), { id: 'partial' });
		expect(report.routes).toBe(2);
		// An unresolvable ref becomes an empty object rather than a lost route.
		expect(serve(pack, { path: '/broken' }).body).toEqual({});
		expect(report.warnings.some((w) => w.includes('/empty'))).toBe(true);
	});

	it('prepends canned auth routes ahead of declared operations', () => {
		const { pack, report } = generatePack(
			{
				servers: [{ url: 'https://api.auth.test' }],
				components: {
					securitySchemes: {
						o: { type: 'oauth2', flows: { c: { tokenUrl: 'https://api.auth.test/oauth/token' } } },
					},
				},
				paths: {
					// The spec documents its own token response; the canned one must win.
					'/oauth/token': {
						post: { responses: { '200': { content: { 'application/json': { example: { access_token: 'from-spec' } } } } } },
					},
				},
			} as OpenApiDoc,
			{ id: 'auth' },
		);
		expect(pack.routes[0]!.match.path).toBe('/oauth/token');
		expect(pack.routes[0]!.respond!.status).toBe(200);
		// Both routes exist, but the canned one is first and therefore serves.
		expect(report.routes).toBe(2);
		expect(pack.routes[0]!.respond!.body).toMatchObject({ access_token: 'mock-access-token' });
	});

	it('handles Swagger 2.0: host/basePath for domains, response.schema for bodies', () => {
		const { pack, report } = generatePack(load('swagger2'), { id: 'legacy' });
		expect(pack.domains).toEqual(['api.legacy.test']);
		const list = serve(pack, { path: '/v2/widgets' });
		expect(list.status).toBe(200);
		expect((list.body as Array<{ name: string }>)[0]!.name).toBe('Cog');
		expect(report.warnings).toEqual([]);
	});

	it('resolves an internal path-item $ref', () => {
		const { pack } = generatePack(load('swagger2'), { id: 'legacy' });
		expect((serve(pack, { path: '/v2/shared' }).body as { name: string }).name).toBe('Cog');
	});

	it('reports an unresolvable path-item $ref instead of dropping it silently', () => {
		const { report } = generatePack(load('swagger2'), { id: 'legacy' });
		const skipped = report.skipped.find((s) => s.path === '/remote');
		expect(skipped).toBeDefined();
		expect(skipped!.reason).toMatch(/external|unresolvable/i);
		expect(skipped!.reason).toContain('example.test');
	});

	it('is byte-stable across runs', () => {
		const a = generatePack(load('petstore'), { id: 'petstore' }).pack;
		const b = generatePack(load('petstore'), { id: 'petstore' }).pack;
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});

describe('oversized generated bodies', () => {
	/** Wide as well as deep — the shape the depth cap does not bound. */
	const wideDeep = (depth: number): Record<string, unknown> => {
		if (depth === 0) return { type: 'string' };
		const properties: Record<string, unknown> = {};
		for (let i = 0; i < 8; i++) {
			properties[`field${String(i).padStart(2, '0')}`] = wideDeep(depth - 1);
		}
		return { type: 'object', properties };
	};

	const specWith = (schema: unknown): OpenApiDoc =>
		({
			openapi: '3.0.0',
			servers: [{ url: 'https://api.wide.test' }],
			paths: {
				'/envelopes': {
					get: {
						responses: { '200': { content: { 'application/json': { schema } } } },
					},
				},
			},
		}) as unknown as OpenApiDoc;

	it('warns when a body is too large to be a useful mock', () => {
		// Deliberately 8 wide by 5 deep, not wider. The generator has no breadth
		// cap, so a genuinely pathological schema exhausts memory before any
		// warning can be emitted — the warning covers the DocuSign class of
		// problem, not the fatal one.
		const { report } = generatePack(specWith(wideDeep(5)), { id: 'wide' });
		const warning = report.warnings.find((w) => w.includes('generated body is'));
		expect(warning).toBeDefined();
		expect(warning).toMatch(/wide as well as deep/);
	});

	it('says nothing about an ordinary body', () => {
		const { report } = generatePack(
			specWith({ type: 'object', properties: { id: { type: 'string' } } }),
			{ id: 'small' },
		);
		expect(report.warnings.filter((w) => w.includes('generated body is'))).toEqual([]);
	});

	it('leaves the generated pack byte-identical — the warning is advisory only', () => {
		const a = JSON.stringify(generatePack(specWith(wideDeep(4)), { id: 'w' }).pack);
		const b = JSON.stringify(generatePack(specWith(wideDeep(4)), { id: 'w' }).pack);
		expect(a).toBe(b);
	});
});
