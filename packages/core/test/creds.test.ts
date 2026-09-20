import { describe, it, expect } from 'vitest';
import { synthesizeCredential } from '../src/creds.js';

const httpHeaderAuth = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		value: { type: 'string' },
		useCustomAuth: { type: 'notice' },
		allowedHttpRequestDomains: { type: 'string', enum: ['all', 'domains', 'none'] },
	},
};

describe('synthesizeCredential', () => {
	it('fills every data field from the type schema', () => {
		expect(synthesizeCredential(httpHeaderAuth)).toEqual({
			name: 'integration-mock',
			value: 'integration-mock',
			allowedHttpRequestDomains: 'all',
		});
	});

	it('omits UI-only properties, which carry no data', () => {
		expect(synthesizeCredential(httpHeaderAuth)).not.toHaveProperty('useCustomAuth');
	});

	it('prefers the first enum value over a bare placeholder', () => {
		expect(synthesizeCredential(httpHeaderAuth).allowedHttpRequestDomains).toBe('all');
	});

	it('honours a schema default above everything but an override', () => {
		const s = { properties: { region: { type: 'string', default: 'us-east-1' } } };
		expect(synthesizeCredential(s).region).toBe('us-east-1');
		expect(synthesizeCredential(s, { region: 'eu-west-1' }).region).toBe('eu-west-1');
	});

	it('types placeholders by declared type', () => {
		const s = { properties: { n: { type: 'number' }, b: { type: 'boolean' }, s: { type: 'string' } } };
		expect(synthesizeCredential(s)).toEqual({ b: false, n: 0, s: 'integration-mock' });
	});

	it('keeps an override for a field the schema does not declare', () => {
		expect(synthesizeCredential(httpHeaderAuth, { baseUrl: 'http://127.0.0.1:8080/x' })).toMatchObject({
			baseUrl: 'http://127.0.0.1:8080/x',
		});
	});

	it('is deterministic, per the generation invariant', () => {
		expect(synthesizeCredential(httpHeaderAuth)).toEqual(synthesizeCredential(httpHeaderAuth));
		expect(Object.keys(synthesizeCredential(httpHeaderAuth))).toEqual([
			'allowedHttpRequestDomains',
			'name',
			'value',
		]);
	});

	it('survives a schema with no properties at all', () => {
		expect(synthesizeCredential({})).toEqual({});
	});
});
