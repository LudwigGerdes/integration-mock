import { describe, it, expect } from 'vitest';
import { redact } from '../src/redact.js';

describe('redact', () => {
	it('header keys by default (case-insensitive)', () => {
		expect(redact({ Authorization: 'Bearer abc', cookie: 'x=1', ok: 'v' })).toEqual({
			Authorization: '[REDACTED]',
			cookie: '[REDACTED]',
			ok: 'v',
		});
	});

	it('token-shaped strings', () => {
		const v = redact({
			t: 'xoxb-0123456789abcdefghijk',
			short: 'abc',
			sentence: 'hello world this is fine',
		});
		expect(v).toEqual({ t: '[REDACTED]', short: 'abc', sentence: 'hello world this is fine' });
	});

	it('custom paths incl. wildcard and array', () => {
		const v = redact(
			{ user: { email: 'a@b.c' }, items: [{ secret: 1 }, { secret: 2 }] },
			{ paths: ['user.email', 'items[*].secret'] },
		);
		expect(v).toEqual({
			user: { email: '[REDACTED]' },
			items: [{ secret: '[REDACTED]' }, { secret: '[REDACTED]' }],
		});
	});

	it('custom patterns; does not mutate', () => {
		const src = { k: 'sk-live-1' };
		const out = redact(src, { patterns: [/^sk-live/] });
		expect(out).toEqual({ k: '[REDACTED]' });
		expect(src.k).toBe('sk-live-1');
	});

	it('widens the header list to the API-key headers vendors use', () => {
		const v = redact({
			'x-auth-token': 'a', apikey: 'b', 'api-key': 'c', 'private-token': 'd',
			'ocp-apim-subscription-key': 'e', 'x-amz-security-token': 'f', 'proxy-authorization': 'g',
			accept: 'application/json',
		});
		expect(Object.values(v).filter((x) => x === '[REDACTED]')).toHaveLength(7);
		expect(v.accept).toBe('application/json');
	});

	it('recognises JWTs, Basic credentials and key=value token params', () => {
		const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
		const v = redact({ jwt, basic: 'Basic dXNlcjpwYXNz', bearer: `Bearer ${jwt}`, plain: 'user:pass' });
		expect(v.jwt).toBe('[REDACTED]');
		expect(v.basic).toBe('[REDACTED]');
		expect(v.bearer).toBe('[REDACTED]');
		expect(v.plain).toBe('user:pass');
	});

	it('redacts credential query parameters by name, whatever their value', () => {
		const v = redact({ token: 'x', api_key: 'y', apikey: 'z', access_token: 'w', page: '2', sig: 'q' });
		expect(v).toEqual({ token: '[REDACTED]', api_key: '[REDACTED]', apikey: '[REDACTED]', access_token: '[REDACTED]', page: '2', sig: 'q' });
	});
});
