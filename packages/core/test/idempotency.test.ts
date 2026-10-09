import { describe, it, expect } from 'vitest';
import { bodyHash, IdempotencyCache, idempotencyKey } from '../src/idempotency.js';
import type { MockRequest } from '../src/types.js';

const req = (o: Partial<MockRequest> = {}): MockRequest => ({ method: 'POST', host: 'h', path: '/', query: {}, headers: {}, ...o });

describe('idempotencyKey', () => {
	it('reads the header case-insensitively, or a body path', () => {
		expect(idempotencyKey({ header: 'Idempotency-Key' }, req({ headers: { 'idempotency-key': 'k1' } }), undefined)).toBe('k1');
		expect(idempotencyKey({ from: 'body.requestId' }, req(), { requestId: 'r9' })).toBe('r9');
		expect(idempotencyKey({ header: 'Idempotency-Key' }, req(), undefined)).toBeUndefined();
	});
});

describe('bodyHash', () => {
	it('ignores key order but not values', () => {
		expect(bodyHash({ a: 1, b: { c: 2, d: 3 } })).toBe(bodyHash({ b: { d: 3, c: 2 }, a: 1 }));
		expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }));
		expect(bodyHash('amount=100')).not.toBe(bodyHash('amount=200'));
	});
});

describe('IdempotencyCache', () => {
	const response = { status: 200, headers: { 'content-type': 'application/json' }, body: { id: 'ch_1' } };

	it('misses, then hits with the same body, then conflicts with another', () => {
		const cache = new IdempotencyCache();
		expect(cache.lookup('stripe/charge', 'k', 'amount=100')).toEqual({ kind: 'miss' });
		cache.remember('stripe/charge', 'k', 'amount=100', response);
		expect(cache.lookup('stripe/charge', 'k', 'amount=100')).toEqual({ kind: 'hit', response });
		expect(cache.lookup('stripe/charge', 'k', 'amount=200')).toEqual({ kind: 'conflict' });
		expect(cache.lookup('stripe/refund', 'k', 'amount=100')).toEqual({ kind: 'miss' });
	});

	it('hands back a copy, and clear forgets everything', () => {
		const cache = new IdempotencyCache();
		cache.remember('s', 'k', {}, response);
		const hit = cache.lookup('s', 'k', {});
		if (hit.kind === 'hit') (hit.response.body as { id: string }).id = 'mutated';
		expect(cache.lookup('s', 'k', {})).toEqual({ kind: 'hit', response });
		cache.clear();
		expect(cache.lookup('s', 'k', {})).toEqual({ kind: 'miss' });
	});
});

describe('review fixes: idempotency cache', () => {
	it('keeps at most 10000 keys, evicting the oldest', () => {
		const cache = new IdempotencyCache();
		const r = { status: 200, headers: {}, body: {} };
		for (let i = 0; i <= 10000; i++) cache.remember('s', `k${i}`, {}, r);
		expect(cache.lookup('s', 'k0', {})).toEqual({ kind: 'miss' });
		expect(cache.lookup('s', 'k10000', {}).kind).toBe('hit');
		expect(cache.size).toBe(10000);
	});
});
