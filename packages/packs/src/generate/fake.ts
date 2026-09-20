import type { Schema } from './openapi.js';

/** FNV-1a → mulberry32. Seeded so a pack regenerates byte-identically. */
export function makeRng(seed: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fixed, not random: a stable fake diffs cleanly, and variety buys nothing here. */
const FORMATS: Record<string, string> = {
	'date-time': '2026-01-01T00:00:00.000Z',
	date: '2026-01-01',
	email: 'user@example.com',
	uri: 'https://example.com',
	url: 'https://example.com',
	uuid: '00000000-0000-4000-8000-000000000000',
};

const MAX_DEPTH = 6;
const isObj = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v);

export function fakeFromSchema(schema: Schema, rng: () => number, depth = 0): unknown {
	if (depth > MAX_DEPTH) return null;
	if (schema.example !== undefined) return schema.example;
	if (schema.default !== undefined) return schema.default;
	if (schema.enum !== undefined && schema.enum.length > 0) return schema.enum[0];

	if (schema.allOf !== undefined && schema.allOf.length > 0) {
		const merged: Record<string, unknown> = {};
		for (const part of schema.allOf) {
			const v = fakeFromSchema(part, rng, depth + 1);
			if (isObj(v)) Object.assign(merged, v);
		}
		return merged;
	}

	const branch = schema.oneOf?.[0] ?? schema.anyOf?.[0];
	if (branch !== undefined) return fakeFromSchema(branch, rng, depth + 1);

	switch (schema.type) {
		case 'string':
			return FORMATS[schema.format ?? ''] ?? `s${Math.floor(rng() * 1e6)}`;
		case 'integer':
			return Math.floor(rng() * 1000);
		case 'number':
			return Math.round(rng() * 10000) / 100;
		case 'boolean':
			return rng() > 0.5;
		case 'array':
			return schema.items === undefined ? [] : [fakeFromSchema(schema.items, rng, depth + 1)];
		case 'object': {
			const out: Record<string, unknown> = {};
			// Sorted so key order — and therefore the serialised pack — is stable.
			for (const k of Object.keys(schema.properties ?? {}).sort()) {
				out[k] = fakeFromSchema(schema.properties![k]!, rng, depth + 1);
			}
			return out;
		}
		default:
			return {};
	}
}
