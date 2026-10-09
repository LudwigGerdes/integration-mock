import { createHash } from 'node:crypto';
import { getPath } from './filter.js';
import type { IdempotencySpec, MockRequest } from './types.js';

export interface RememberedResponse {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

/** Keys kept per store; the oldest is evicted past this. */
const MAX_ENTRIES = 10_000;

export type IdempotencyLookup = { kind: 'miss' } | { kind: 'hit'; response: RememberedResponse } | { kind: 'conflict' };

const stable = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(stable)
		: v !== null && typeof v === 'object'
			? Object.fromEntries(
					Object.entries(v as Record<string, unknown>)
						.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
						.map(([k, x]) => [k, stable(x)]),
				)
			: v;

/** A digest of a request body; key order does not matter, values do. */
export const bodyHash = (body: unknown): string =>
	createHash('sha256')
		.update(typeof body === 'string' ? body : JSON.stringify(stable(body ?? null)))
		.digest('hex');

/** The request's idempotency key, from the header (case-insensitive) or a body path. */
export function idempotencyKey(spec: IdempotencySpec, req: MockRequest, body: unknown): string | undefined {
	if (spec.header !== undefined) {
		const v = req.headers[spec.header.toLowerCase()];
		if (typeof v === 'string' && v !== '') return v;
	}
	if (spec.from !== undefined && spec.from.startsWith('body.')) {
		const v = getPath(body, spec.from.slice('body.'.length));
		if (typeof v === 'string' && v !== '') return v;
		if (typeof v === 'number') return String(v);
	}
	return undefined;
}

/**
 * Remembered responses per (scope, key). The same key with the same body gets
 * the first response back; with a different body it is a conflict, as Stripe
 * answers it.
 */
export class IdempotencyCache {
	private entries = new Map<string, { hash: string; response: RememberedResponse }>();

	lookup(scope: string, key: string, body: unknown): IdempotencyLookup {
		const seen = this.entries.get(`${scope}\u0000${key}`);
		if (seen === undefined) return { kind: 'miss' };
		if (seen.hash !== bodyHash(body)) return { kind: 'conflict' };
		return { kind: 'hit', response: structuredClone(seen.response) };
	}

	remember(scope: string, key: string, body: unknown, response: RememberedResponse): void {
		this.entries.set(`${scope}\u0000${key}`, { hash: bodyHash(body), response: structuredClone(response) });
		// Bounded, as a long-running daemon would otherwise keep every response.
		if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
	}

	get size(): number {
		return this.entries.size;
	}

	clear(): void {
		this.entries.clear();
	}
}
