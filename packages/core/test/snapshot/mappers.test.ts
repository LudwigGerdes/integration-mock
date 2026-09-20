import { describe, it, expect } from 'vitest';
import {
	httpRequestMapper,
	mapperFor,
	registerMapper,
	serviceIdForHost,
} from '../../src/snapshot/mappers.js';
import type { N8nNode } from '../../src/snapshot/n8n-client.js';

const node = (parameters: Record<string, unknown>): N8nNode => ({
	name: 'Fetch',
	type: 'n8n-nodes-base.httpRequest',
	typeVersion: 4.2,
	parameters,
});

describe('httpRequestMapper', () => {
	it('service id', () => expect(serviceIdForHost('api.example.com')).toBe('api-example-com'));

	it('GET with literal query, multi-item output → array body', () => {
		const routes = httpRequestMapper.fromNodeOutput(
			node({
				url: 'https://api.example.com/users',
				sendQuery: true,
				queryParameters: {
					parameters: [
						{ name: 'page', value: '1' },
						{ name: 'x', value: '={{ $json.y }}' },
					],
				},
			}),
			[{ id: 1 }, { id: 2 }],
		);
		expect(routes).toEqual([
			{
				id: 'api-example-com:GET:/users#0',
				match: { method: 'GET', path: '/users', query: { page: '1' } },
				respond: { status: 200, body: [{ id: 1 }, { id: 2 }] },
			},
		]);
	});

	it('single item → object body; POST with json body → bodyMatch', () => {
		const routes = httpRequestMapper.fromNodeOutput(
			node({
				url: 'https://h.com/v1/x',
				method: 'POST',
				sendBody: true,
				specifyBody: 'json',
				jsonBody: '{"a":1}',
			}),
			[{ ok: true }],
		);
		expect(routes[0]!.match).toEqual({ method: 'POST', path: '/v1/x', bodyMatch: { a: 1 } });
		expect(routes[0]!.respond).toEqual({ status: 200, body: { ok: true } });
	});

	it('fullResponse output shape', () => {
		const routes = httpRequestMapper.fromNodeOutput(
			node({ url: 'https://h.com/p', options: { response: { response: { fullResponse: true } } } }),
			[{ body: { k: 1 }, headers: { 'content-type': 'application/json' }, statusCode: 201 }],
		);
		expect(routes[0]!.respond).toEqual({ status: 201, body: { k: 1 } });
	});

	it('expression url → no routes', () =>
		expect(httpRequestMapper.fromNodeOutput(node({ url: '={{ $json.url }}' }), [{}])).toEqual([]));

	it('registry', () => {
		const m = { nodeType: 'x.y', service: 'y', fromNodeOutput: (): [] => [] };
		registerMapper(m);
		expect(mapperFor('x.y')).toBe(m);
		expect(mapperFor('n8n-nodes-base.httpRequest')).toBe(httpRequestMapper);
	});
});
