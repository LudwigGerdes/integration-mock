import { describe, it, expect } from 'vitest';
import { derefDeep, resolveRef } from '../../src/generate/deref.js';
import type { OpenApiDoc } from '../../src/generate/openapi.js';

const doc: OpenApiDoc = {
	components: {
		schemas: {
			User: {
				type: 'object',
				properties: { id: { type: 'string' }, self: { $ref: '#/components/schemas/User' } },
			},
		},
	},
};

describe('resolveRef', () => {
	it('resolves a local ref', () =>
		expect(resolveRef(doc, '#/components/schemas/User')).toMatchObject({ type: 'object' }));

	it('returns null for external or missing refs', () => {
		expect(resolveRef(doc, 'other.yaml#/X')).toBeNull();
		expect(resolveRef(doc, '#/components/schemas/Nope')).toBeNull();
	});
});

describe('derefDeep', () => {
	it('inlines refs and breaks cycles with an empty object', () => {
		const out = derefDeep(doc, { $ref: '#/components/schemas/User' }) as {
			type: string;
			properties: { id: { type: string }; self: unknown };
		};
		expect(out.type).toBe('object');
		expect(out.properties.id).toEqual({ type: 'string' });
		expect(out.properties.self).toEqual({});
	});

	it('walks arrays and leaves plain values alone', () => {
		expect(derefDeep(doc, [{ $ref: '#/components/schemas/User' }, 5])).toMatchObject([
			{ type: 'object' },
			5,
		]);
	});
});

describe('derefDeep blowup guards', () => {
	/**
	 * A diamond graph, not a cycle: each level references the next level twice,
	 * so naive expansion is 2^depth. Real specs (Stripe) have exactly this shape,
	 * and it OOM'd a 4 GB heap before the depth bound existed.
	 */
	const diamond = (levels: number): OpenApiDoc => {
		const schemas: Record<string, unknown> = {};
		for (let i = 0; i < levels; i++) {
			schemas[`L${i}`] = {
				type: 'object',
				properties: {
					a: { $ref: `#/components/schemas/L${i + 1}` },
					b: { $ref: `#/components/schemas/L${i + 1}` },
				},
			};
		}
		schemas[`L${levels}`] = { type: 'string' };
		return { components: { schemas } };
	};

	it('bounds expansion of a deeply shared ref graph', () => {
		const doc = diamond(16);
		const started = Date.now();
		const out = derefDeep(doc, { $ref: '#/components/schemas/L0' });
		expect(Date.now() - started).toBeLessThan(1000);
		// 2^16 expansions would be megabytes; the bound keeps it small.
		expect(JSON.stringify(out).length).toBeLessThan(50_000);
	});
});
