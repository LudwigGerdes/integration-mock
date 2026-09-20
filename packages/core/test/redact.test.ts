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
});
