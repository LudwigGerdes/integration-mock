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
	/** Render `{{…}}` placeholders in body and headers from the request (see template.ts). Off by default. */
	template?: boolean;
	/** A sequence entry's own store op (see store-op.ts). */
	store?: StoreSpec;
}

export interface Route {
	id: string;
	match: RouteMatch;
	respond?: RouteResponse;
	/**
	 * Responses in call order: the first call gets the first, the second the
	 * second. Past the end, `respond` answers; without one, the last entry
	 * repeats. Counts reset with `packs reset`.
	 */
	sequence?: RouteResponse[];
	/** Act on the service's resource store; `respond` is rendered with the result (see store-op.ts). */
	store?: StoreSpec;
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
	/** The pack's own version, for a team that publishes and pins its packs. */
	version?: string;
	/** Who maintains it: a team, a person, a mailbox. Free text. */
	owner?: string;
	description?: string;
	/** Licence of the pack's contents, where the source spec's licence applies. */
	license?: string;
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

/** How a store-backed route names and mints a record's id. */
export interface IdSpec {
	/** The property that holds the id. Default `id`. */
	field?: string;
	/** Literal text plus `{{seq:N}}` (zero-padded per-collection counter) or `{{uuid}}`. Default `{{uuid}}`. */
	format?: string;
}

export type StoreOpName = 'create' | 'get' | 'update' | 'delete' | 'list';

export type PaginationStyle = 'cursor' | 'offset' | 'page' | 'nextUrl';

export interface PaginationSpec {
	style: PaginationStyle;
	cursorParam?: string;
	offsetParam?: string;
	pageParam?: string;
	limitParam?: string;
	/** Where the paging params are read from. Default `query`. */
	in?: 'query' | 'body';
	defaultLimit?: number;
	maxLimit?: number;
	sort?: { field: string; direction?: 'asc' | 'desc' };
	/** `nextUrl`, issuing route: the URL of the next page; `{{token}}` is the page token. */
	nextUrlTemplate?: string;
	/** `nextUrl`, follow-up route: the path param (or query param) holding the token. */
	tokenParam?: string;
}

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

/** One request input compared with one record field. `from` is `query.<name>`, `body.<path>` or `params.<name>`. */
export interface FlatFilter {
	from: string;
	field: string;
	op?: FilterOp;
}

/** A structured filter in a vendor's own shape. */
export interface StyledFilter {
	from: string;
	/** `unsupported`: the vendor honours this input but the mock does not; sending it answers 400. */
	style: 'hubspot' | 'soql' | 'unsupported';
}

export type FilterSpec = FlatFilter | StyledFilter;

export interface IdempotencySpec {
	/** Request header holding the key, e.g. `Idempotency-Key`. Matched case-insensitively. */
	header?: string;
	/** `body.<path>` holding the key. */
	from?: string;
}

export interface StoreSpec {
	op: StoreOpName;
	collection?: string;
	idParam?: string;
	id?: IdSpec;
	update?: 'merge' | 'replace';
	stamp?: Record<string, unknown>;
	notFound?: RouteResponse;
	badRequest?: RouteResponse;
	conflict?: RouteResponse;
	pagination?: PaginationSpec;
	filters?: FilterSpec[];
	idempotency?: IdempotencySpec;
	/** Form-encoded values arrive as strings; coerce the named fields to the type the vendor returns. */
	coerce?: Record<string, 'number' | 'boolean'>;
}
