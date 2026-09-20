import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { realPackFetcher } from '../src/commands/packs-fetch.js';

let srv: Server;
let base: string;

beforeAll(async () => {
	srv = createServer((req, res) => {
		if (req.url === '/redirect') {
			res.writeHead(302, { location: '/final' });
			res.end();
			return;
		}
		if (req.url === '/final') {
			res.end('{"id":"stripe"}');
			return;
		}
		res.writeHead(404);
		res.end('nope');
	});
	await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((r) => srv.close(() => r())));

describe('realPackFetcher', () => {
	it('follows a redirect — raw.githubusercontent.com answers with one', async () => {
		expect(await realPackFetcher(`${base}/redirect`)).toBe('{"id":"stripe"}');
	});

	it('turns a connection failure into a one-line error naming the URL', async () => {
		const closed = createServer();
		await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
		const port = (closed.address() as { port: number }).port;
		await new Promise<void>((r) => closed.close(() => r()));

		const url = `http://127.0.0.1:${port}/pack.json`;
		const err = await realPackFetcher(url).then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		const msg = (err as Error).message;
		expect(msg).toContain(url);
		expect(msg).not.toContain('\n');
		expect(msg).not.toMatch(/maxRedirections/);
	});

	it('explains a 404 with the --ref hint', async () => {
		await expect(realPackFetcher(`${base}/missing`)).rejects.toThrow(/--ref main/);
	});
});
