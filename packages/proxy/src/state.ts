import { join } from 'node:path';
import {
	FaultController,
	RequestLog,
	ResourceStore,
	projectPacksDir,
	resolve,
	savePack,
	redact,
	serviceForHost,
	serviceForPrefix,
	type FaultSpec,
	type Faults,
	type LayeredPacks,
	type MockRequest,
	type Mode,
	type Resolution,
	type Route,
	type ServicePack,
	type Snapshot,
} from 'integration-mock-core';

export interface ProxyState {
	mode: Mode;
	enabledPacks: string[];
	activeSnapshot?: Snapshot;
	faults: Faults;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const LAYERS: Array<keyof LayeredPacks> = ['snapshot', 'project', 'user', 'library'];

/**
 * Everything the proxy needs to decide and serve a call, minus the transport.
 *
 * Runtime state (mode, enabled packs, active snapshot, faults) lives here and
 * only here — the CLI is a stateless client of the admin API in front of it.
 */
export class MockEngine {
	private packs: LayeredPacks;
	private log: RequestLog;
	private faults: FaultController;
	private mode: Mode = 'off';
	private enabled: Set<string>;
	private snapshot?: Snapshot;
	private stores = new Map<string, ResourceStore>();
	private recording = new Map<string, ServicePack>();

	/** The project config's `redact` paths, applied to everything written to disk. */
	private readonly redactPaths: string[];
	/** The release that is recording, for the stamp on a recorded pack. */
	private readonly version: string | undefined;

	constructor(opts: {
		packs: LayeredPacks;
		log: RequestLog;
		faults: FaultController;
		enabledPacks?: string[];
		redactPaths?: string[];
		version?: string;
	}) {
		this.packs = opts.packs;
		this.log = opts.log;
		this.faults = opts.faults;
		this.enabled = new Set(opts.enabledPacks ?? []);
		this.redactPaths = opts.redactPaths ?? [];
		this.version = opts.version;
	}

	/** The in-memory log, as it is served: credentials replaced, as in the file on disk. */
	redactedLog(filter: Parameters<RequestLog['list']>[0] = {}): ReturnType<RequestLog['list']> {
		return this.log.list(filter).map((entry) => redact(entry, { paths: this.redactPaths }));
	}

	get logRef(): RequestLog {
		return this.log;
	}

	get faultsRef(): FaultController {
		return this.faults;
	}

	state(): ProxyState {
		return {
			mode: this.mode,
			enabledPacks: [...this.enabled],
			activeSnapshot: this.snapshot,
			faults: this.faults.snapshot(),
		};
	}

	setMode(m: Mode): void {
		this.mode = m;
	}

	setEnabledPacks(ids: string[]): void {
		this.enabled = new Set(ids);
	}

	/**
	 * Swap whole layers for freshly loaded ones. The daemon reads the disk
	 * layers once at boot; `packs init`, `eject` and a hand-written pack all
	 * land after that, so the admin API re-reads them before applying a new
	 * enabled list. A pack being recorded lives in memory ahead of disk and is
	 * kept over any on-disk copy of the same id.
	 */
	replaceLayers(layers: Partial<Pick<LayeredPacks, 'library' | 'user' | 'project'>>): void {
		if (layers.library !== undefined) this.packs.library = layers.library;
		if (layers.user !== undefined) this.packs.user = layers.user;
		if (layers.project !== undefined) {
			const live = [...this.recording.values()];
			const liveIds = new Set(live.map((p) => p.id));
			this.packs.project = layers.project.filter((p) => !liveIds.has(p.id)).concat(live);
		}
		this.stores.clear();
	}

	/** Add a pack to the library layer at runtime (tests, and record's host lookup). */
	registerPack(p: ServicePack): void {
		this.packs.library = this.packs.library.filter((x) => x.id !== p.id).concat(p);
	}

	activateSnapshot(s: Snapshot | undefined): void {
		this.snapshot = s;
		this.packs.snapshot = s?.packs ?? [];
		for (const p of this.packs.snapshot) this.enabled.add(p.id);
		this.stores.clear();
	}

	resetStores(): void {
		this.stores.clear();
	}

	/** Service id when this host should be intercepted, else `null` (raw tunnel). */
	shouldIntercept(host: string): string | null {
		if (this.mode === 'off') return null;
		const s = serviceForHost(this.packs, host);
		return s !== null && this.enabled.has(s) ? s : null;
	}

	/**
	 * Which service serves this path in base-URL mode, what the vendor would
	 * have seen, and the host to present as its own.
	 *
	 * Deliberately does NOT consult `mode`. Interception is ambiguous — traffic
	 * arrives whether or not the user meant it to be mocked — but pointing a URL
	 * at the mock is explicit. See spec D6.
	 */
	serviceForBaseUrl(path: string): { service: string; rest: string; host: string } | null {
		const hit = serviceForPrefix(this.packs, path);
		if (hit === null || !this.enabled.has(hit.service)) return null;
		const pack = LAYERS.flatMap((l) => this.packs[l]).find((p) => p.id === hit.service);
		if (pack === undefined) return null;
		// A pack reachable only by prefix claims no vendor domain — generic-rest
		// is exactly that. Refusing to serve it here would make base-URL mode
		// reject the one pack that exists solely to be served by prefix. The host
		// is presentational (routes match on method and path), so synthesise one.
		const host = pack.domains[0] ?? `${pack.id}.integration-mock.local`;
		return { ...hit, host };
	}

	/** Enabled service id -> its base-URL prefix. The CLI holds no packs of its own. */
	enabledPrefixes(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const pk of LAYERS.flatMap((l) => this.packs[l])) {
			if (this.enabled.has(pk.id) && out[pk.id] === undefined) out[pk.id] = pk.prefix;
		}
		return out;
	}

	private store(service: string): ResourceStore {
		let st = this.stores.get(service);
		if (!st) {
			const seed = LAYERS.flatMap((l) => this.packs[l]).find((p) => p.id === service && p.seed)
				?.seed;
			st = new ResourceStore(seed);
			this.stores.set(service, st);
		}
		return st;
	}

	private logCall(
		service: string,
		req: MockRequest,
		res: Resolution,
		started: number,
		fault?: FaultSpec,
	): void {
		this.log.append({
			service,
			method: req.method,
			url: `https://${req.host}${req.path}`,
			path: req.path,
			query: req.query,
			reqHeaders: req.headers,
			reqBody: req.body,
			status: res.status,
			resHeaders: res.headers,
			resBody: res.body,
			latencyMs: Date.now() - started,
			matchedRoute: res.matched === 'unmatched' ? 'unmatched' : res.matched.routeId,
			layer: res.matched === 'unmatched' ? undefined : res.matched.layer,
			...(fault ? { fault } : {}),
		});
	}

	/** Serve one intercepted call in replay mode: faults first, then layered resolution. */
	async handleReplay(service: string, req: MockRequest): Promise<Resolution> {
		const started = Date.now();
		const fault = this.faults.next(service) ?? undefined;
		if (fault?.delayMs) await sleep(fault.delayMs);

		let res: Resolution;
		if (fault && (fault.empty === true || fault.status !== undefined)) {
			res = {
				status: fault.status ?? 200,
				headers: { 'content-type': 'application/json' },
				body: fault.empty === true ? undefined : (fault.body ?? { error: 'integration-mock fault' }),
				matched: 'unmatched',
			};
		} else {
			res = resolve(this.packs, service, req, this.store(service));
		}
		this.logCall(service, req, res, started, fault);
		return res;
	}

	/**
	 * Record mode: the caller has already fetched the real response. Log it as a
	 * passthrough and append a route to the project-layer recording pack so the
	 * very next replay serves it.
	 */
	async recordUpstream(
		service: string,
		req: MockRequest,
		up: { status: number; headers: Record<string, string>; body: unknown },
	): Promise<void> {
		const started = Date.now();
		this.log.append({
			service,
			method: req.method,
			url: `https://${req.host}${req.path}`,
			path: req.path,
			query: req.query,
			reqHeaders: req.headers,
			reqBody: req.body,
			status: up.status,
			resHeaders: up.headers,
			resBody: up.body,
			latencyMs: Date.now() - started,
			matchedRoute: 'passthrough',
		});

		let pack = this.recording.get(service);
		if (!pack) {
			pack = {
				id: service,
				domains: [req.host],
				prefix: '/' + service,
				routes: [],
				source: 'recorded',
				// The file will be committed; say when and by what it was made,
				// and that what is in it went through the redactor.
				provenance: {
					recordedAt: new Date().toISOString(),
					...(this.version === undefined ? {} : { tool: { name: 'integration-mock', version: this.version } }),
					redacted: true,
				},
			};
			this.recording.set(service, pack);
			this.packs.project = this.packs.project.filter((p) => p.id !== service).concat(pack);
		}
		if (!pack.domains.includes(req.host)) pack.domains.push(req.host);

		const n = pack.routes.filter(
			(r) => r.match.method === req.method && r.match.path === req.path,
		).length;
		// The pack is written to a directory the docs say to commit, so nothing a
		// vendor returned or n8n sent may reach it as sent: token query params,
		// credential headers and token-shaped values are replaced before the
		// route is built. The in-memory log above keeps the entry whole.
		const contentType = up.headers['content-type'];
		const query = redact(req.query, { paths: this.redactPaths });
		const route: Route = {
			id: `${service}:${req.method}:${req.path}#${n}`,
			match: {
				method: req.method,
				path: req.path,
				...(Object.keys(query).length ? { query } : {}),
			},
			respond: {
				status: up.status,
				headers: contentType !== undefined ? { 'content-type': contentType } : {},
				body: redact(up.body, { paths: this.redactPaths }),
			},
		};
		pack.routes.push(route);
		await savePack(join(projectPacksDir(), service), pack);
	}
}
