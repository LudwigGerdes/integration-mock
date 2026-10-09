import type { MockRequest } from './types.js';

type Container = Record<string, unknown> | unknown[];

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const KEY = /^([^[\]]+)((?:\[[^[\]]*\])*)$/;

const isContainer = (v: unknown): v is Container => v !== null && typeof v === 'object';

/** Set `value` at `path`, creating arrays for `[]`/`[n]` steps and objects otherwise. */
function assign(target: Record<string, unknown>, path: string[], value: string): void {
	if (path.some((p) => UNSAFE.has(p))) return;
	let cur: Container = target;
	for (let i = 0; i < path.length; i++) {
		const key = path[i]!;
		const last = i === path.length - 1;
		const next = path[i + 1];
		const fresh = (): Container => (next === '' || /^\d+$/.test(next ?? '') ? [] : {});
		if (Array.isArray(cur)) {
			const index = key === '' ? cur.length : Number(key);
			if (!Number.isInteger(index)) return;
			if (last) {
				cur[index] = value;
				return;
			}
			const existing: unknown = cur[index];
			const child = isContainer(existing) ? existing : fresh();
			cur[index] = child;
			cur = child;
		} else {
			if (last) {
				cur[key] = value;
				return;
			}
			const existing = cur[key];
			const child = isContainer(existing) ? existing : fresh();
			cur[key] = child;
			cur = child;
		}
	}
}

/**
 * `application/x-www-form-urlencoded` with bracket syntax, as Stripe sends it:
 * `metadata[plan]=pro&items[0][price]=p_1&expand[]=customer` →
 * `{ metadata: { plan: 'pro' }, items: [{ price: 'p_1' }], expand: ['customer'] }`.
 * Values stay strings: the vendor's own parser decides types, and a mock that
 * guessed would answer differently from it.
 */
export function parseFormBody(text: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [rawKey, value] of new URLSearchParams(text)) {
		const m = KEY.exec(rawKey);
		const path = m ? [m[1]!, ...[...m[2]!.matchAll(/\[([^[\]]*)\]/g)].map((x) => x[1]!)] : [rawKey];
		assign(out, path, value);
	}
	return out;
}

export const isFormRequest = (req: MockRequest): boolean =>
	(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded');
