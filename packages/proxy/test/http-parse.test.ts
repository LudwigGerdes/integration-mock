import { describe, it, expect } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import type { MockRequest } from 'integration-mock-core';
import { toMockRequest, readBody } from '../src/http-parse.js';

const roundtrip = (
	method: string,
	url: string,
	headers: Record<string, string>,
	body?: string,
): Promise<MockRequest> =>
	new Promise<MockRequest>((res, rej) => {
		const srv = createServer((req, resp) => {
			readBody(req)
				.then((raw) => {
					res(toMockRequest(req, 'h.com', raw));
					resp.end();
					srv.close();
				})
				.catch(rej);
		});
		srv.listen(0, '127.0.0.1', () => {
			const r = httpRequest({
				host: '127.0.0.1',
				port: (srv.address() as { port: number }).port,
				method,
				path: url,
				headers,
			});
			if (body !== undefined) r.write(body);
			r.end();
		});
	});

describe('toMockRequest', () => {
	it('parses json body, query, headers', async () => {
		const m = await roundtrip('POST', '/api/x?a=1&b=two', { 'Content-Type': 'application/json' }, '{"k":1}');
		expect(m).toMatchObject({
			method: 'POST',
			host: 'h.com',
			path: '/api/x',
			query: { a: '1', b: 'two' },
			body: { k: 1 },
		});
		expect(m.headers['content-type']).toBe('application/json');
		expect(m.rawBody?.toString()).toBe('{"k":1}');
	});

	it('absolute-form url', async () => {
		const m = await roundtrip('GET', 'http://h.com/p/q?z=9', {});
		expect(m.path).toBe('/p/q');
		expect(m.query).toEqual({ z: '9' });
	});

	it('text body kept as string; invalid json falls back to string', async () => {
		expect((await roundtrip('POST', '/t', { 'content-type': 'text/plain' }, 'hi')).body).toBe('hi');
		expect((await roundtrip('POST', '/t', { 'content-type': 'application/json' }, '{bad')).body).toBe(
			'{bad',
		);
	});
});
