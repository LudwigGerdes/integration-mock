import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AuthMode, FaultSpec, HttpMethod, LogEntry, Mode, RateLimitScenario, Snapshot } from 'integration-mock-core';
import { readBody } from './http-parse.js';
import type { MockEngine, ProxyState } from './state.js';

const ROUTE_METHODS: ReadonlyArray<HttpMethod | '*'> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', '*'];
const isRouteMethod = (v: unknown): v is HttpMethod | '*' => ROUTE_METHODS.some((m) => m === v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isWholeAtLeastOne = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** A rate-limit body, or the reason it is unusable. */
function rateLimitFrom(b: unknown): RateLimitScenario | string {
	if (!isRecord(b)) return 'body required';
	if (!isWholeAtLeastOne(b.calls)) return 'calls must be an integer >= 1';
	if (!isWholeAtLeastOne(b.perMs)) return 'perMs must be an integer >= 1';
	const limit: RateLimitScenario = { calls: b.calls, perMs: b.perMs };
	if (b.route !== undefined) {
		const r = b.route;
		if (!isRecord(r) || !isRouteMethod(r.method)) return 'route.method must be an HTTP method or *';
		if (typeof r.path !== 'string' || !r.path.startsWith('/')) return 'route.path must start with /';
		limit.route = { method: r.method, path: r.path };
	}
	return limit;
}

/** The active snapshot is reduced on the wire — callers want its identity, not its packs. */
export type StateWire = Omit<ProxyState, 'activeSnapshot'> & {
	activeSnapshot?: { executionId: string; workflowId: string };
	/** Enabled service id -> base-URL prefix. The CLI holds no packs of its own. */
	packPrefixes: Record<string, string>;
};

export interface AdminServer {
	port: number;
	close(): Promise<void>;
}

/**
 * The only mutation path into a running proxy.
 *
 * Loopback is the zero-config local path and needs no token. Any other bind —
 * docker sets `INTEGRATION_MOCK_ADMIN_BIND` to the compose network — is reachable from
 * off-host and therefore requires a bearer token. Authentication is the
 * control plane's own; it must not depend on a gateway being in front of it.
 */
export async function startAdmin(opts: {
	engine: MockEngine;
	port: number;
	token?: string;
	/** Re-read pack layers from disk; run before a new enabled list is applied. */
	reloadPacks?: () => Promise<void>;
}): Promise<AdminServer> {
	const { engine } = opts;
	const bind =
		process.env.INTEGRATION_MOCK_ADMIN_BIND ?? '127.0.0.1';
	const loopback = bind === '127.0.0.1' || bind === '::1' || bind === 'localhost';

	// Fail at startup rather than serving an open control plane on a reachable
	// interface. A server that 401s everything would read as a bug, not a refusal.
	if (!loopback && opts.token === undefined) {
		throw new Error(`integration-mock: admin API bound to ${bind} requires a token`);
	}

	const json = (res: ServerResponse, status: number, body?: unknown): void => {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(body === undefined ? '' : JSON.stringify(body));
	};

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		void (async () => {
			const url = new URL(req.url ?? '/', 'http://admin');
			const m = req.method ?? 'GET';
			const p = url.pathname;

			if (!loopback && req.headers.authorization !== `Bearer ${opts.token}`) {
				return json(res, 401, { error: 'unauthorized' });
			}

			const body = async (): Promise<unknown> => {
				const raw = await readBody(req);
				return raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
			};

			if (m === 'GET' && p === '/state') {
				const s = engine.state();
				const wire: StateWire = {
					...s,
					packPrefixes: engine.enabledPrefixes(),
					activeSnapshot: s.activeSnapshot && {
						executionId: s.activeSnapshot.executionId,
						workflowId: s.activeSnapshot.workflowId,
					},
				};
				return json(res, 200, wire);
			}
			if (m === 'PUT' && p === '/mode') {
				engine.setMode(((await body()) as { mode: Mode }).mode);
				return json(res, 204);
			}
			if (m === 'PUT' && p === '/packs/enabled') {
				const ids = ((await body()) as { ids: string[] }).ids;
				// A pack enabled a moment after it was written must be servable now,
				// not after a restart — reload the layers the engine read at boot.
				await opts.reloadPacks?.();
				engine.setEnabledPacks(ids);
				return json(res, 204);
			}
			if (m === 'POST' && p === '/packs/reset') {
				engine.resetStores();
				return json(res, 204);
			}
			if (p.startsWith('/scenarios/')) {
				const [, , kind, service] = p.split('/');
				const one = service === undefined || service === '' ? undefined : service;
				if (m === 'DELETE' && kind === 'auth') {
					engine.scenariosRef.clearAuth(one);
					return json(res, 204);
				}
				if (m === 'DELETE' && kind === 'limits') {
					engine.scenariosRef.clearLimit(one);
					return json(res, 204);
				}
				if (m === 'PUT' && one !== undefined && kind === 'auth') {
					const b = await body();
					const mode = isRecord(b) ? b.mode : undefined;
					if (mode !== 'revoked' && mode !== 'forbidden') {
						return json(res, 400, { error: 'mode must be "revoked" or "forbidden"' });
					}
					engine.scenariosRef.setAuth(one, mode);
					return json(res, 204);
				}
				if (m === 'PUT' && one !== undefined && kind === 'limits') {
					const limit = rateLimitFrom(await body());
					if (typeof limit === 'string') return json(res, 400, { error: limit });
					engine.scenariosRef.setLimit(one, limit);
					return json(res, 204);
				}
			}
			if (p.startsWith('/faults')) {
				const service = p.split('/')[2];
				if (m === 'PUT' && service !== undefined && service !== '') {
					engine.faultsRef.set(service, (await body()) as FaultSpec);
					return json(res, 204);
				}
				if (m === 'DELETE') {
					engine.faultsRef.clear(service === '' ? undefined : service);
					return json(res, 204);
				}
			}
			if (p === '/log') {
				if (m === 'GET') {
					const q = url.searchParams;
					const since = q.get('since');
					const limit = q.get('limit');
					return json(
						res,
						200,
						engine.redactedLog({
							service: q.get('service') ?? undefined,
							since: since === null ? undefined : Number(since),
							limit: limit === null ? undefined : Number(limit),
						}),
					);
				}
				if (m === 'DELETE') {
					engine.logRef.clear();
					return json(res, 204);
				}
			}
			if (p === '/snapshot') {
				if (m === 'PUT') {
					engine.activateSnapshot((await body()) as Snapshot);
					engine.setMode('replay');
					return json(res, 204);
				}
				if (m === 'DELETE') {
					engine.activateSnapshot(undefined);
					return json(res, 204);
				}
			}
			return json(res, 404, { error: 'not found' });
		})().catch((e: unknown) => {
			json(res, 500, { error: String(e) });
		});
	});

	await new Promise<void>((r) => server.listen(opts.port, bind, r));
	return {
		port: (server.address() as { port: number }).port,
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
}

export interface LogFilter {
	service?: string;
	since?: number;
	limit?: number;
}

/** Stateless client for the admin API — the CLI, MCP and future UI all go through it. */
export class AdminClient {
	constructor(
		private base: string,
		private token?: string,
	) {}

	private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (this.token !== undefined) headers.authorization = `Bearer ${this.token}`;
		const r = await fetch(this.base + path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!r.ok) throw new Error(`admin ${method} ${path} → ${r.status}`);
		return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
	}

	getState(): Promise<StateWire> {
		return this.call<StateWire>('GET', '/state');
	}
	setMode(mode: Mode): Promise<void> {
		return this.call<void>('PUT', '/mode', { mode });
	}
	setEnabledPacks(ids: string[]): Promise<void> {
		return this.call<void>('PUT', '/packs/enabled', { ids });
	}
	setFault(service: string, spec: FaultSpec): Promise<void> {
		return this.call<void>('PUT', `/faults/${service}`, spec);
	}
	clearFaults(service?: string): Promise<void> {
		return this.call<void>('DELETE', service !== undefined ? `/faults/${service}` : '/faults');
	}
	setAuthScenario(service: string, mode: AuthMode): Promise<void> {
		return this.call<void>('PUT', `/scenarios/auth/${service}`, { mode });
	}
	clearAuthScenario(service?: string): Promise<void> {
		return this.call<void>('DELETE', service !== undefined ? `/scenarios/auth/${service}` : '/scenarios/auth');
	}
	setRateLimit(service: string, limit: RateLimitScenario): Promise<void> {
		return this.call<void>('PUT', `/scenarios/limits/${service}`, limit);
	}
	clearRateLimit(service?: string): Promise<void> {
		return this.call<void>('DELETE', service !== undefined ? `/scenarios/limits/${service}` : '/scenarios/limits');
	}
	getLog(f: LogFilter = {}): Promise<LogEntry[]> {
		const q = new URLSearchParams(
			Object.entries(f)
				.filter(([, v]) => v !== undefined)
				.map(([k, v]) => [k, String(v)]),
		);
		return this.call<LogEntry[]>('GET', `/log${q.size ? '?' + q.toString() : ''}`);
	}
	clearLog(): Promise<void> {
		return this.call<void>('DELETE', '/log');
	}
	activateSnapshot(s: Snapshot): Promise<void> {
		return this.call<void>('PUT', '/snapshot', s);
	}
	clearSnapshot(): Promise<void> {
		return this.call<void>('DELETE', '/snapshot');
	}
	resetPacks(): Promise<void> {
		return this.call<void>('POST', '/packs/reset');
	}
}
