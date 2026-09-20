import {
	createServer as createHttpServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import { request as undiciRequest, type Dispatcher } from 'undici';
import { leafCertFor } from './ca.js';
import { readBody, toMockRequest } from './http-parse.js';
import { startAdmin } from './admin.js';
import type { MockEngine } from './state.js';

export interface ProxyServerOpts {
	port?: number;
	adminPort?: number;
	engine: MockEngine;
	ca: { certPem: string; keyPem: string };
	/** Dispatcher for upstream calls in record/passthrough. Tests use it to trust a throwaway CA. */
	upstream?: Dispatcher;
	/** Required when the admin API binds anywhere but loopback. */
	adminToken?: string;
	/** Re-read pack layers before a new enabled list is applied (see startAdmin). */
	reloadPacks?: () => Promise<void>;
}

export interface ProxyServer {
	port: number;
	adminPort: number;
	close(): Promise<void>;
}

/** Headers that describe one hop and must not be forwarded or echoed back. */
const HOP = new Set([
	'proxy-connection',
	'proxy-authorization',
	'connection',
	'keep-alive',
	'transfer-encoding',
	'host',
	'content-length',
]);

interface Target {
	host: string;
	port: number;
}

/**
 * The forward proxy.
 *
 * `CONNECT` for a host the engine does not intercept is a raw TCP tunnel: no
 * TLS termination, nothing logged, nothing to go wrong. Intercepted hosts get a
 * leaf certificate minted on the spot and their decrypted requests handed to an
 * internal HTTP server that serves mocks or records the real response.
 */
export async function startProxy(opts: ProxyServerOpts): Promise<ProxyServer> {
	const { engine, ca, upstream } = opts;
	const targetOf = new WeakMap<Socket, Target>();

	const upstreamUrl = (t: Target, rawUrl: string): string => {
		const suffix = t.port === 443 ? '' : `:${t.port}`;
		return `https://${t.host}${suffix}${rawUrl}`;
	};

	async function serve(
		req: IncomingMessage,
		res: ServerResponse,
		target: Target,
		service: string,
	): Promise<void> {
		const raw = await readBody(req);
		const mreq = toMockRequest(req, target.host, raw);

		if (engine.state().mode === 'record') {
			const fwdHeaders: Record<string, string> = {};
			for (const [k, v] of Object.entries(mreq.headers)) if (!HOP.has(k)) fwdHeaders[k] = v;

			const up = await undiciRequest(upstreamUrl(target, req.url ?? '/'), {
				method: mreq.method,
				headers: fwdHeaders,
				body: raw.length ? raw : undefined,
				dispatcher: upstream,
			});
			const buf = Buffer.from(await up.body.arrayBuffer());

			const upHeaders: Record<string, string> = {};
			for (const [k, v] of Object.entries(up.headers)) {
				if (typeof v === 'string') upHeaders[k] = v;
				else if (Array.isArray(v)) upHeaders[k] = v.join(', ');
			}
			const ct = upHeaders['content-type'] ?? '';
			let body: unknown = buf.toString('utf8');
			if (ct.includes('json')) {
				try {
					body = JSON.parse(body as string);
				} catch {
					// keep the text
				}
			}
			await engine.recordUpstream(service, mreq, { status: up.statusCode, headers: upHeaders, body });

			res.writeHead(
				up.statusCode,
				Object.fromEntries(Object.entries(upHeaders).filter(([k]) => !HOP.has(k))),
			);
			res.end(buf);
			return;
		}

		const r = await engine.handleReplay(service, mreq);
		const payload =
			r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
		res.writeHead(r.status, { ...r.headers, 'content-length': Buffer.byteLength(payload) });
		res.end(payload);
	}

	// Serves requests coming out of TLS termination; never listens on a port itself.
	const inner: Server = createHttpServer((req, res) => {
		const target = targetOf.get(req.socket as Socket) ?? {
			host: req.headers.host?.split(':')[0] ?? '',
			port: 443,
		};
		const service = engine.shouldIntercept(target.host);
		if (service === null) {
			res.writeHead(502);
			res.end('integration-mock: not intercepted');
			return;
		}
		serve(req, res, target, service).catch((e: unknown) => {
			res.writeHead(500);
			res.end(String(e));
		});
	});

	/**
	 * Base-URL mode: a direct client, not a proxy client.
	 *
	 * The path is rewritten to what the vendor would have seen and the pack's
	 * canonical domain is presented as the host, so a pack recorded through the
	 * proxy replays byte-identically here and the log reads the same in both
	 * modes.
	 */
	async function serveBaseUrl(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const u = new URL(req.url ?? '/', 'http://mock');
		const hit = engine.serviceForBaseUrl(u.pathname);
		if (hit === null) {
			res.writeHead(404, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					error: 'integration-mock: no enabled pack serves this path',
					path: u.pathname,
				}),
			);
			return;
		}
		const raw = await readBody(req);
		req.url = hit.rest + u.search;
		const out = await engine.handleReplay(hit.service, toMockRequest(req, hit.host, raw));
		res.writeHead(out.status, out.headers);
		res.end(out.body === undefined ? '' : JSON.stringify(out.body));
	}

	const server = createHttpServer((req, res) => {
		void (async () => {
			// HTTP distinguishes the two callers in the request line: a proxy
			// client sends an absolute URI, a direct client sends origin-form.
			// One port therefore serves both modes, and one address to expose.
			if ((req.url ?? '').startsWith('/')) {
				await serveBaseUrl(req, res);
				return;
			}

			// Plain-HTTP proxying: the request line carries an absolute URI.
			let url: URL;
			try {
				url = new URL(req.url ?? '');
			} catch {
				res.writeHead(400);
				res.end();
				return;
			}
			const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
			const service = engine.shouldIntercept(url.hostname);
			if (service !== null) {
				req.url = url.pathname + url.search;
				await serve(req, res, { host: url.hostname, port }, service);
				return;
			}
			const raw = await readBody(req);
			const headers: Record<string, string> = {};
			for (const [k, v] of Object.entries(req.headers)) {
				if (HOP.has(k.toLowerCase()) || v === undefined) continue;
				headers[k] = Array.isArray(v) ? v.join(', ') : v;
			}
			const up = await undiciRequest(url, {
				method: (req.method ?? 'GET') as 'GET',
				headers,
				body: raw.length ? raw : undefined,
				dispatcher: upstream,
			});
			res.writeHead(up.statusCode, up.headers as Record<string, string>);
			up.body.pipe(res);
		})().catch(() => {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		});
	});

	server.on('connect', (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
		const [host, portStr] = (req.url ?? '').split(':');
		const port = Number(portStr) || 443;
		const service = host !== undefined && host !== '' ? engine.shouldIntercept(host) : null;

		if (host === undefined || host === '' || service === null) {
			const upstreamSocket = netConnect(port, host, () => {
				clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
				if (head.length) upstreamSocket.write(head);
				upstreamSocket.pipe(clientSocket);
				clientSocket.pipe(upstreamSocket);
			});
			upstreamSocket.on('error', () => clientSocket.destroy());
			clientSocket.on('error', () => upstreamSocket.destroy());
			return;
		}

		clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
		const leaf = leafCertFor(host, ca);
		const tlsSocket = new TLSSocket(clientSocket, {
			isServer: true,
			cert: leaf.certPem,
			key: leaf.keyPem,
		});
		targetOf.set(tlsSocket, { host, port });
		tlsSocket.on('error', () => tlsSocket.destroy());
		if (head.length) tlsSocket.unshift(head);
		inner.emit('connection', tlsSocket);
	});

	await new Promise<void>((r) => server.listen(opts.port ?? 8080, '0.0.0.0', r));
	const admin = await startAdmin({
		engine,
		port: opts.adminPort ?? 8081,
		token: opts.adminToken,
		reloadPacks: opts.reloadPacks,
	});
	const port = (server.address() as { port: number }).port;

	return {
		port,
		adminPort: admin.port,
		close: async () => {
			await admin.close();
			await new Promise<void>((r) => server.close(() => r()));
			inner.close();
		},
	};
}
