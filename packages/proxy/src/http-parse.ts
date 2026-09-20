import type { IncomingMessage } from 'node:http';
import type { HttpMethod, MockRequest } from 'integration-mock-core';

export function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((res, rej) => {
		const chunks: Buffer[] = [];
		req.on('data', (d: Buffer) => chunks.push(d));
		req.on('end', () => res(Buffer.concat(chunks)));
		req.on('error', rej);
	});
}

/**
 * Node's decrypted request → the transport-agnostic `MockRequest` core matches on.
 *
 * `req.url` is origin-form after TLS termination and absolute-form for plain
 * proxy requests; both parse against the CONNECT host.
 */
export function toMockRequest(req: IncomingMessage, host: string, raw: Buffer): MockRequest {
	const u = new URL(req.url ?? '/', `https://${host}`);

	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(req.headers)) {
		if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
	}

	const ct = headers['content-type'] ?? '';
	let body: unknown;
	if (raw.length) {
		const text = raw.toString('utf8');
		if (ct.includes('json')) {
			try {
				body = JSON.parse(text);
			} catch {
				body = text;
			}
		} else if (ct.startsWith('text/') || ct.includes('form')) {
			body = text;
		}
	}

	return {
		method: (req.method ?? 'GET').toUpperCase() as HttpMethod,
		host,
		path: u.pathname,
		query: Object.fromEntries(u.searchParams),
		headers,
		body,
		rawBody: raw,
	};
}
