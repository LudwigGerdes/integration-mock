import { describe, it, expect } from 'vitest';
import { pairInfoFromContainer } from '../src/commands/proxy.js';

/**
 * Inside the pair the admin API binds 0.0.0.0, so it demands the bearer token
 * the daemon mints into the container's volume. `up` has to carry that token to
 * the host, or every later verb (`status`, `on`, `log`, …) answers 401.
 */
describe('pairInfoFromContainer', () => {
	it('carries the token across and pins the published ports and pid 0', () => {
		const raw = JSON.stringify({ port: 8080, adminPort: 8081, pid: 1, token: 'abc-123' });
		expect(pairInfoFromContainer(raw)).toEqual({ port: 8080, adminPort: 8081, pid: 0, token: 'abc-123' });
	});

	it('ignores the container-side ports, which need not match what is published', () => {
		const raw = JSON.stringify({ port: 9999, adminPort: 9998, pid: 7, token: 't' });
		expect(pairInfoFromContainer(raw)).toMatchObject({ port: 8080, adminPort: 8081, pid: 0 });
	});

	it('fails loudly when the container has not minted a token', () => {
		expect(() => pairInfoFromContainer(JSON.stringify({ port: 8080, adminPort: 8081, pid: 1 }))).toThrow(/token/);
	});

	it('fails loudly on unreadable output rather than writing a tokenless file', () => {
		expect(() => pairInfoFromContainer('not json')).toThrow(/proxy\.json/);
	});
});
