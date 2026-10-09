import { describe, it, expect } from 'vitest';
import { isFormRequest, parseFormBody } from '../src/form-body.js';

describe('parseFormBody', () => {
	it('reads plain keys, decoding + and %xx', () => {
		expect(parseFormBody('email=ada%40example.com&name=Ada+Lovelace')).toEqual({
			email: 'ada@example.com',
			name: 'Ada Lovelace',
		});
	});

	it('nests bracket keys into objects and arrays, as Stripe sends them', () => {
		expect(
			parseFormBody('metadata[plan]=pro&metadata[seats]=5&items[0][price]=p_1&items[1][price]=p_2&expand[]=customer&expand[]=invoice'),
		).toEqual({
			metadata: { plan: 'pro', seats: '5' },
			items: [{ price: 'p_1' }, { price: 'p_2' }],
			expand: ['customer', 'invoice'],
		});
	});

	it('never writes to the prototype', () => {
		const out = parseFormBody('__proto__[polluted]=yes&constructor[prototype][x]=1&ok=1');
		expect(out).toEqual({ ok: '1' });
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
	});

	it('returns an empty object for an empty body', () => {
		expect(parseFormBody('')).toEqual({});
	});
});

describe('isFormRequest', () => {
	it('recognises the form content type, with or without a charset', () => {
		const req = (ct?: string) => ({ method: 'POST' as const, host: 'h', path: '/', query: {}, headers: ct ? { 'content-type': ct } : {} });
		expect(isFormRequest(req('application/x-www-form-urlencoded'))).toBe(true);
		expect(isFormRequest(req('application/x-www-form-urlencoded; charset=utf-8'))).toBe(true);
		expect(isFormRequest(req('application/json'))).toBe(false);
		expect(isFormRequest(req())).toBe(false);
	});
});
