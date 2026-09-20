/**
 * Scrub credential-shaped example values out of generated bodies.
 *
 * Vendor specs carry real-looking secrets as examples — GitHub's spec ships a
 * complete RSA private key as the `pem` example on every app-installation
 * route, and SendGrid's ships a signed S3 URL with an AWS access-key id in it.
 * None of them is a live credential, but every secret scanner (GitHub push
 * protection, gitleaks, trufflehog) flags them, and a mock that hands out a
 * PEM block teaches nobody anything a labelled placeholder would not.
 *
 * Pure and deterministic: the same input always gives the same output, so
 * regeneration stays byte-stable.
 */

export const PLACEHOLDER_PRIVATE_KEY =
	'-----BEGIN EXAMPLE PRIVATE KEY-----\nTHIS-IS-A-PLACEHOLDER-NOT-A-REAL-KEY\n-----END EXAMPLE PRIVATE KEY-----';

export const PLACEHOLDER_AWS_KEY_ID = 'AKIAEXAMPLEPLACEHOLDER0';

/** A complete PEM private-key block, or an unterminated one running to end of string. */
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*$)/g;

/** AWS access-key ids are `AKIA` + 16 upper-case alphanumerics; accept a few shorter fakes too. */
const AWS_KEY_ID = /\bAKIA[0-9A-Z]{12,}\b/g;

export function sanitizeString(s: string): string {
	return s.replace(PEM_BLOCK, PLACEHOLDER_PRIVATE_KEY).replace(AWS_KEY_ID, PLACEHOLDER_AWS_KEY_ID);
}

/** Deep-walk any JSON value, rewriting every string; key order is preserved. */
export function sanitizeExamples<T>(value: T): T {
	if (typeof value === 'string') return sanitizeString(value) as unknown as T;
	if (Array.isArray(value)) return value.map((v: unknown) => sanitizeExamples(v)) as unknown as T;
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = sanitizeExamples(v);
		}
		return out as T;
	}
	return value;
}
