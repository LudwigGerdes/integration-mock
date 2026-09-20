import { describe, it, expect } from 'vitest';
import { authRoutes } from '../../src/generate/auth.js';
import type { OpenApiDoc } from '../../src/generate/openapi.js';

const doc = (schemes: Record<string, unknown>): OpenApiDoc =>
	({ components: { securitySchemes: schemes } }) as OpenApiDoc;

describe('authRoutes', () => {
	it('cans an oauth2 token endpoint from its tokenUrl', () => {
		const routes = authRoutes(
			doc({
				oauth: {
					type: 'oauth2',
					flows: {
						authorizationCode: {
							tokenUrl: 'https://api.v.test/oauth/token',
							authorizationUrl: 'https://api.v.test/oauth/authorize',
						},
					},
				},
			}),
			'v',
			'',
		);
		expect(routes).toHaveLength(1);
		expect(routes[0]!.match).toEqual({ method: 'POST', path: '/oauth/token' });
		expect(routes[0]!.respond!.body).toMatchObject({
			access_token: 'mock-access-token',
			token_type: 'Bearer',
		});
	});

	it('adds a separate route for a distinct refreshUrl and dedupes an identical one', () => {
		expect(
			authRoutes(
				doc({ o: { type: 'oauth2', flows: { c: { tokenUrl: 'https://a.test/t', refreshUrl: 'https://a.test/r' } } } }),
				'v',
				'',
			),
		).toHaveLength(2);
		expect(
			authRoutes(
				doc({ o: { type: 'oauth2', flows: { c: { tokenUrl: 'https://a.test/t', refreshUrl: 'https://a.test/t' } } } }),
				'v',
				'',
			),
		).toHaveLength(1);
	});

	it('ignores non-oauth schemes and malformed urls', () => {
		expect(authRoutes(doc({ b: { type: 'http', scheme: 'bearer' } }), 'v', '')).toEqual([]);
		expect(authRoutes(doc({ k: { type: 'apiKey', name: 'X-Key', in: 'header' } }), 'v', '')).toEqual([]);
		expect(authRoutes(doc({ o: { type: 'oauth2', flows: { c: { tokenUrl: 'not a url' } } } }), 'v', '')).toEqual([]);
		expect(authRoutes({}, 'v', '')).toEqual([]);
	});
});
