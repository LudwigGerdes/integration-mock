export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface RouteMatch {
	method: HttpMethod | '*';
	path: string;
	query?: Record<string, string>;
	bodyMatch?: unknown;
}

export interface RouteResponse {
	status: number;
	headers?: Record<string, string>;
	body?: unknown;
}

export interface Route {
	id: string;
	match: RouteMatch;
	respond?: RouteResponse;
	handler?: string;
	/** Where this route came from — a doc section for authored packs. */
	note?: string;
}

/**
 * Where a pack came from. `authored` means written by hand or by an agent from
 * documentation — a considered guess, unlike `openapi` (a faithful rendering of
 * a published spec) or `recorded` (observed traffic). Verify will treat them
 * differently: an authored route disagreeing with reality is expected, a
 * recorded one disagreeing is a signal.
 */
export type PackSource =
	| 'library'
	| 'recorded'
	| 'openapi'
	| 'authored'
	| `snapshot:${string}`;

export interface ServicePack {
	id: string;
	domains: string[];
	prefix: string;
	baseUrlCredential?: { type: string; field: string };
	routes: Route[];
	seed?: Record<string, unknown[]>;
	source: PackSource;
	spec?: { url?: string; file?: string; version?: string; vendorSha?: string };
	/** Written by `record`: when, by which release, and that the bodies were redacted. */
	provenance?: PackProvenance;
}

export interface PackProvenance {
	recordedAt?: string;
	tool?: { name: string; version: string };
	redacted?: boolean;
}

export type Layer = 'library' | 'user' | 'project' | 'snapshot' | 'store';

export interface MockRequest {
	method: HttpMethod;
	host: string;
	path: string;
	query: Record<string, string>;
	headers: Record<string, string>;
	body?: unknown;
	rawBody?: Buffer;
}

export interface Resolution {
	status: number;
	headers: Record<string, string>;
	body: unknown;
	matched: { routeId: string; layer: Layer } | 'unmatched';
}

export interface FaultSpec {
	status?: number;
	body?: unknown;
	delayMs?: number;
	empty?: boolean;
	after?: number;
	once?: boolean;
}

export type Faults = Record<string, FaultSpec>;

export interface LogEntry {
	id: string;
	ts: number;
	service: string;
	method: HttpMethod;
	url: string;
	path: string;
	query: Record<string, string>;
	reqHeaders: Record<string, string>;
	reqBody?: unknown;
	status: number;
	resHeaders: Record<string, string>;
	resBody?: unknown;
	latencyMs: number;
	matchedRoute: string | 'passthrough' | 'unmatched';
	layer?: Layer;
	fault?: FaultSpec;
}

export interface Snapshot {
	executionId: string;
	workflowId: string;
	instance: string;
	createdAt: number;
	workflowHash: string;
	nodeHashes: Record<string, string>;
	packs: ServicePack[];
	nodeOutputs: Record<string, unknown[]>;
	warnings: string[];
	/**
	 * What the snapshot was taken from, for an audit trail. Absent on
	 * snapshots written before it existed. Never a URL, key or cookie: the
	 * instance is the saved name, and the payloads are redacted.
	 */
	provenance?: SnapshotProvenance;
}

export interface SnapshotProvenance {
	tool?: { name: string; version: string };
	n8nVersion?: string;
	workflow: { id: string; name?: string; versionId?: string; active?: boolean };
	execution: { id: string; status?: string; startedAt?: string; stoppedAt?: string; mode?: string };
	redacted: true;
}

export type Mode = 'off' | 'replay' | 'record';
