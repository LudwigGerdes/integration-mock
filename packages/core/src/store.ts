import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import { IdempotencyCache } from './idempotency.js';
import { PageTokens } from './paginate.js';
import type { IdSpec, MockRequest, Resolution } from './types.js';

type Item = Record<string, unknown>;

const clone = <T>(v: T): T => structuredClone(v);
const isPlain = (v: unknown): v is Item => v !== null && typeof v === 'object' && !Array.isArray(v);
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** Merge `patch` into `base`: plain objects merge key by key; anything else is replaced. */
export function deepMerge(base: Item, patch: Item): Item {
	const out: Item = { ...base };
	for (const [k, v] of Object.entries(patch)) {
		if (UNSAFE.has(k)) continue;
		const current = out[k];
		out[k] = isPlain(v) && isPlain(current) ? deepMerge(current, v) : clone(v);
	}
	return out;
}

/**
 * In-memory collection store with REST-shape inference.
 *
 * Library and OpenAPI-derived packs get stateful CRUD without hand-written
 * handlers: `handle()` recognises `/<collection>` and `/<collection>/<id>`
 * (optionally behind a `/v1`-style or `/api` prefix) and serves list, get,
 * create, update and delete against the seeded data.
 *
 * Store routes (`route.store`) use the same collections through the typed
 * methods below; `idSpecs` says which field holds each collection's id and how
 * a new one is minted. The page tokens and idempotency entries those routes
 * issue live here too, so every reset path that recreates the store clears them.
 */
export class ResourceStore {
	private seed: Record<string, unknown[]>;
	private readonly idSpecs: Record<string, IdSpec>;
	private data = new Map<string, Item[]>();
	private seq = new Map<string, number>();
	readonly idempotency = new IdempotencyCache();
	readonly tokens = new PageTokens();

	constructor(seed: Record<string, unknown[]> = {}, idSpecs: Record<string, IdSpec> = {}) {
		this.seed = clone(seed);
		this.idSpecs = idSpecs;
		this.reset();
	}

	reset(seed?: Record<string, unknown[]>): void {
		if (seed) this.seed = clone(seed);
		this.data.clear();
		this.seq.clear();
		this.idempotency.clear();
		this.tokens.clear();
		for (const [c, items] of Object.entries(this.seed)) {
			this.data.set(
				c,
				items.map((i) => this.withId(c, i)),
			);
		}
	}

	/** The property that holds a collection's ids. */
	idField(c: string): string {
		return this.idSpecs[c]?.field ?? 'id';
	}

	/** Whether the collection exists: seeded, or created during this session. */
	has(c: string): boolean {
		return this.data.has(c);
	}

	/** A collection this store knows, matched case-insensitively (SOQL object names); else the name as given. */
	resolveCollection(name: string): string {
		const lower = name.toLowerCase();
		return [...this.data.keys(), ...Object.keys(this.idSpecs)].find((k) => k.toLowerCase() === lower) ?? name;
	}

	private mint(c: string): string {
		const spec = this.idSpecs[c];
		if (spec === undefined) return nanoid(10);
		const format = spec.format ?? '{{uuid}}';
		return format.replace(/\{\{\s*(?:seq:(\d+)|uuid)\s*\}\}/g, (_m, width: string | undefined) => {
			if (width === undefined) return randomUUID();
			const n = (this.seq.get(c) ?? 0) + 1;
			this.seq.set(c, n);
			return String(n).padStart(Number(width), '0');
		});
	}

	private withId(c: string, i: unknown): Item {
		const o: Item = isPlain(i) ? clone(i) : {};
		const field = this.idField(c);
		if (typeof o[field] !== 'string') o[field] = this.mint(c);
		return o;
	}

	private coll(c: string): Item[] {
		if (!this.data.has(c)) this.data.set(c, []);
		return this.data.get(c)!;
	}

	private indexOf(c: string, id: string): number {
		const field = this.idField(c);
		return this.coll(c).findIndex((i) => i[field] === id);
	}

	list(c: string): Item[] {
		return clone(this.coll(c));
	}

	get(c: string, id: string): Item | undefined {
		const f = this.coll(c)[this.indexOf(c, id)];
		return f && clone(f);
	}

	create(c: string, item: unknown): Item {
		const it = this.withId(c, item);
		this.coll(c).push(it);
		return clone(it);
	}

	/** Shallow update, as the generic REST fallback has always done. */
	update(c: string, id: string, patch: unknown): Item | undefined {
		const arr = this.coll(c);
		const idx = this.indexOf(c, id);
		if (idx < 0) return undefined;
		const p = isPlain(patch) ? patch : {};
		arr[idx] = { ...arr[idx]!, ...p, [this.idField(c)]: id };
		return clone(arr[idx]);
	}

	/** Store-route update: deep `merge` or `replace`; the id always stays the one asked for. */
	updateRecord(c: string, id: string, patch: Item, mode: 'merge' | 'replace'): Item | undefined {
		const arr = this.coll(c);
		const idx = this.indexOf(c, id);
		if (idx < 0) return undefined;
		const field = this.idField(c);
		arr[idx] = mode === 'replace' ? { ...clone(patch), [field]: id } : { ...deepMerge(arr[idx]!, patch), [field]: id };
		return clone(arr[idx]);
	}

	delete(c: string, id: string): boolean {
		const arr = this.coll(c);
		const idx = this.indexOf(c, id);
		if (idx < 0) return false;
		arr.splice(idx, 1);
		return true;
	}

	/** Serve a request if its path has a recognisable REST shape; otherwise `null`. */
	handle(req: MockRequest): Resolution | null {
		let segs = req.path.split('/').filter(Boolean);
		if (segs[0] && (/^v\d+$/.test(segs[0]) || segs[0] === 'api')) segs = segs.slice(1);
		if (segs.length === 0 || segs.length > 2) return null;
		const [coll, id] = segs as [string, string | undefined];
		if (coll.includes('.')) return null;

		// Only collections the pack actually declares (or that were created during
		// this session) are served. Inventing an empty one would answer a stale or
		// unmocked call with `200 {data: []}` instead of the loud 501 the spec
		// promises — and a workflow that proceeds on silently-empty data is worse
		// off than one that fails.
		if (!this.data.has(coll)) return null;

		const json = { 'content-type': 'application/json' };
		const ok = (op: string, status: number, body: unknown): Resolution => ({
			status,
			headers: json,
			body,
			matched: { routeId: `store:${op}:${coll}`, layer: 'store' },
		});

		if (!id) {
			if (req.method === 'GET') return ok('list', 200, { data: this.list(coll) });
			if (req.method === 'POST') return ok('create', 201, this.create(coll, req.body));
			return null;
		}
		if (req.method === 'GET') {
			const it = this.get(coll, id);
			return it ? ok('get', 200, it) : ok('get', 404, { error: 'not found' });
		}
		if (req.method === 'PATCH' || req.method === 'PUT') {
			const it = this.update(coll, id, req.body);
			return it ? ok('update', 200, it) : ok('update', 404, { error: 'not found' });
		}
		if (req.method === 'DELETE') {
			return this.delete(coll, id)
				? ok('delete', 204, undefined)
				: ok('delete', 404, { error: 'not found' });
		}
		return null;
	}
}
