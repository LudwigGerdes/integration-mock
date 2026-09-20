import { describe, it, expect } from 'vitest';
import { fakeFromSchema, makeRng } from '../../src/generate/fake.js';

const rng = () => makeRng('seed');

describe('fakeFromSchema', () => {
	it('prefers example, then default, then enum', () => {
		expect(fakeFromSchema({ type: 'string', example: 'X' }, rng())).toBe('X');
		expect(fakeFromSchema({ type: 'string', default: 'D' }, rng())).toBe('D');
		expect(fakeFromSchema({ type: 'string', enum: ['a', 'b'] }, rng())).toBe('a');
	});

	it('builds objects from properties and arrays from items', () => {
		expect(
			fakeFromSchema(
				{
					type: 'object',
					properties: { id: { type: 'integer' }, name: { type: 'string' }, ok: { type: 'boolean' } },
				},
				rng(),
			),
		).toEqual({ id: expect.any(Number), name: expect.any(String), ok: expect.any(Boolean) });
		const arr = fakeFromSchema({ type: 'array', items: { type: 'string' } }, rng()) as unknown[];
		expect(arr).toHaveLength(1);
	});

	it('honours string formats with fixed values', () => {
		expect(fakeFromSchema({ type: 'string', format: 'date-time' }, rng())).toBe(
			'2026-01-01T00:00:00.000Z',
		);
		expect(fakeFromSchema({ type: 'string', format: 'email' }, rng())).toBe('user@example.com');
	});

	it('merges allOf and takes the first oneOf branch', () => {
		expect(
			fakeFromSchema(
				{
					allOf: [
						{ type: 'object', properties: { a: { type: 'string', example: '1' } } },
						{ type: 'object', properties: { b: { type: 'string', example: '2' } } },
					],
				},
				rng(),
			),
		).toEqual({ a: '1', b: '2' });
		expect(
			fakeFromSchema({ oneOf: [{ type: 'string', example: 'first' }, { type: 'integer' }] }, rng()),
		).toBe('first');
	});

	it('is deterministic for the same seed and differs across seeds', () => {
		const s = { type: 'object', properties: { n: { type: 'integer' }, t: { type: 'string' } } } as const;
		expect(fakeFromSchema(s, makeRng('a'))).toEqual(fakeFromSchema(s, makeRng('a')));
		expect(fakeFromSchema(s, makeRng('a'))).not.toEqual(fakeFromSchema(s, makeRng('b')));
	});

	it('unknown type yields an empty object and depth is capped', () => {
		expect(fakeFromSchema({}, rng())).toEqual({});
		let deep: Record<string, unknown> = { type: 'object', properties: { x: { type: 'string' } } };
		for (let i = 0; i < 10; i++) deep = { type: 'object', properties: { x: deep } };
		expect(() => fakeFromSchema(deep, rng())).not.toThrow();
	});
});
