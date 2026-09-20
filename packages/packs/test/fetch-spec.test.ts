import { describe, it, expect } from 'vitest';
import { MockAgent } from 'undici';
import { fetchSpec } from '../src/fetch-spec.js';
import { sha256 } from '../src/spec-io.js';

// disableNetConnect() is the guard: if this module ever reaches the real network,
// these tests fail rather than silently making requests.
const agent = (): MockAgent => {
	const a = new MockAgent();
	a.disableNetConnect();
	return a;
};

describe('fetchSpec', () => {
	it('returns bytes and their digest', async () => {
		const a = agent();
		a.get('https://vendor.test')
			.intercept({ path: '/openapi.json', method: 'GET' })
			.reply(200, '{"openapi":"3.0.0"}');
		const r = await fetchSpec('https://vendor.test/openapi.json', a);
		expect(r.sha256).toBe(sha256(Buffer.from('{"openapi":"3.0.0"}')));
	});

	it('throws on non-2xx', async () => {
		const a = agent();
		a.get('https://vendor.test').intercept({ path: '/missing', method: 'GET' }).reply(404, '');
		await expect(fetchSpec('https://vendor.test/missing', a)).rejects.toThrow(/→ 404/);
	});
});

describe('fetchSpec on the default dispatcher', () => {
	// No dispatcher injected: this is the path `packs build --fetch` takes, and
	// the one that broke when undici stopped accepting `maxRedirections`.
	it('follows a redirect from a local origin', async () => {
		const { createServer } = await import('node:http');
		const srv = createServer((req, res) => {
			if (req.url === '/spec') {
				res.writeHead(301, { location: '/spec.json' });
				res.end();
				return;
			}
			res.end('{"openapi":"3.0.0"}');
		});
		await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
		const port = (srv.address() as { port: number }).port;
		try {
			const r = await fetchSpec(`http://127.0.0.1:${port}/spec`);
			expect(r.bytes.toString('utf8')).toBe('{"openapi":"3.0.0"}');
		} finally {
			await new Promise<void>((r) => srv.close(() => r()));
		}
	});
});
