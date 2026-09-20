import { describe, it, expect } from 'vitest';
import {
	PLACEHOLDER_AWS_KEY_ID,
	PLACEHOLDER_PRIVATE_KEY,
	sanitizeExamples,
	sanitizeString,
} from '../../src/generate/sanitize.js';
import { generatePack } from '../../src/generate/generate.js';

const RSA =
	'-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEArYxrNYD/iT5CZVpRJu4rBKmmze3PVmT\n-----END RSA PRIVATE KEY-----';

describe('sanitizeString', () => {
	it('replaces a PEM private key block with a labelled placeholder', () => {
		expect(sanitizeString(RSA)).toBe(PLACEHOLDER_PRIVATE_KEY);
	});

	it('handles any key type and surrounding text', () => {
		const s = `"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"`;
		expect(sanitizeString(s)).toBe(`"${PLACEHOLDER_PRIVATE_KEY}"`);
		const ec = 'x -----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY----- y';
		expect(sanitizeString(ec)).toBe(`x ${PLACEHOLDER_PRIVATE_KEY} y`);
	});

	it('scrubs an unterminated block to the end of the string', () => {
		expect(sanitizeString('-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA')).toBe(
			PLACEHOLDER_PRIVATE_KEY,
		);
	});

	it('replaces AWS access-key ids, including inside a URL', () => {
		const url = 'https://bucket.s3.amazonaws.com/f?AWSAccessKeyId=AKIAI4NOW7APZHRFYGWQ&Expires=1';
		expect(sanitizeString(url)).toBe(
			`https://bucket.s3.amazonaws.com/f?AWSAccessKeyId=${PLACEHOLDER_AWS_KEY_ID}&Expires=1`,
		);
		expect(sanitizeString('AKIAACCESSKEYHERE')).toBe(PLACEHOLDER_AWS_KEY_ID);
	});

	it('leaves ordinary strings and public keys alone', () => {
		expect(sanitizeString('hello AKIA world')).toBe('hello AKIA world');
		const pub = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----';
		expect(sanitizeString(pub)).toBe(pub);
	});

	it('is idempotent', () => {
		expect(sanitizeString(sanitizeString(RSA))).toBe(sanitizeString(RSA));
	});
});

describe('sanitizeExamples', () => {
	it('walks objects and arrays, preserving shape, key order and non-strings', () => {
		const input = { a: 1, b: [RSA, { c: null, d: true, e: 'AKIAI4NOW7APZHRFYGWQ' }], f: 'ok' };
		expect(sanitizeExamples(input)).toEqual({
			a: 1,
			b: [PLACEHOLDER_PRIVATE_KEY, { c: null, d: true, e: PLACEHOLDER_AWS_KEY_ID }],
			f: 'ok',
		});
		expect(Object.keys(sanitizeExamples(input))).toEqual(['a', 'b', 'f']);
	});
});

describe('generatePack', () => {
	it('never emits a private key or AWS key id from a spec example', () => {
		const doc = {
			openapi: '3.0.0',
			servers: [{ url: 'https://api.acme.test' }],
			paths: {
				'/app': {
					get: {
						responses: {
							'200': {
								content: {
									'application/json': {
										example: { pem: RSA, url: 'x?AWSAccessKeyId=AKIAI4NOW7APZHRFYGWQ' },
									},
								},
							},
						},
					},
				},
			},
		};
		const { pack } = generatePack(doc, { id: 'acme' });
		const json = JSON.stringify(pack);
		expect(json).not.toMatch(/BEGIN RSA PRIVATE KEY/);
		expect(json).not.toMatch(/AKIAI4NOW7APZHRFYGWQ/);
		expect(json).toContain(PLACEHOLDER_AWS_KEY_ID);
		expect(json).toContain('BEGIN EXAMPLE PRIVATE KEY');
	});
});
