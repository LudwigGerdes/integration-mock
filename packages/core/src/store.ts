import { nanoid } from 'nanoid';
import type { MockRequest, Resolution } from './types.js';

type Item = Record<string, unknown> & { id: string };

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory collection store with REST-shape inference.
 *
 * Library and OpenAPI-derived packs get stateful CRUD without hand-written
 * handlers: `handle()` recognises `/<collection>` and `/<collection>/<id>`
 * (optionally behind a `/v1`-style or `/api` prefix) and serves list, get,
 * create, update and delete against the seeded data.
 */
export class ResourceStore {
	private seed: Record<string, unknown[]>;
	private data = new Map<string, Item[]>();

	constructor(seed: Record<string, unknown[]> = {}) {
		this.seed = clone(seed);
		this.reset();
	}

	reset(seed?: Record<string, unknown[]>): void {
		if (seed) this.seed = clone(seed);
		this.data.clear();
		for (const [c, items] of Object.entries(this.seed)) {
			this.data.set(
				c,
				items.map((i) => this.withId(i)),
			);
		}
	}

	private withId(i: unknown): Item {
		const o = (i && typeof i === 'object' ? clone(i) : {}) as Record<string, unknown>;
		if (typeof o.id !== 'string') o.id = nanoid(10);
		return o as Item;
	}

	private coll(c: string): Item[] {
		if (!this.data.has(c)) this.data.set(c, []);
		return this.data.get(c)!;
	}

	list(c: string): unknown[] {
		return clone(this.coll(c));
	}

	get(c: string, id: string): unknown | undefined {
		const f = this.coll(c).find((i) => i.id === id);
		return f && clone(f);
	}

	create(c: string, item: unknown): unknown {
		const it = this.withId(item);
		this.coll(c).push(it);
		return clone(it);
	}

	update(c: string, id: string, patch: unknown): unknown | undefined {
		const arr = this.coll(c);
		const idx = arr.findIndex((i) => i.id === id);
		if (idx < 0) return undefined;
		const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
		arr[idx] = { ...arr[idx]!, ...p, id };
		return clone(arr[idx]);
	}

	delete(c: string, id: string): boolean {
		const arr = this.coll(c);
		const idx = arr.findIndex((i) => i.id === id);
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
