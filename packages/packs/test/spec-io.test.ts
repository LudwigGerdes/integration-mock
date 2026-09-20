import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	specCacheHome,
	parseSpec,
	readVendoredSpec,
	sha256,
	specPath,
	writeVendoredSpec,
} from '../src/spec-io.js';

describe('spec-io', () => {
	it('parses JSON and YAML specs alike', () => {
		expect(parseSpec(Buffer.from('{"openapi":"3.0.0"}')).openapi).toBe('3.0.0');
		expect(parseSpec(Buffer.from('openapi: 3.0.0\npaths: {}\n')).openapi).toBe('3.0.0');
	});

	it('sha256 is stable and content-sensitive', () => {
		expect(sha256(Buffer.from('a'))).toBe(sha256(Buffer.from('a')));
		expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
		expect(sha256(Buffer.from('a'))).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe('vendored spec cache', () => {
	beforeEach(() => {
		process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'tools-'));
	});

	it('lives under the integration-mock home so tests can redirect it', () => {
		expect(specCacheHome()).toBe(process.env.INTEGRATION_MOCK_HOME);
		expect(specPath('stripe', '2022-11-15')).toBe(
			join(process.env.INTEGRATION_MOCK_HOME!, 'vendor-specs', 'stripe', '2022-11-15', 'openapi.json.gz'),
		);
	});

	it('round-trips bytes through the cache', async () => {
		await writeVendoredSpec('acme', '1.2.3', Buffer.from('{"openapi":"3.0.0"}'));
		const back = await readVendoredSpec('acme', '1.2.3');
		expect(back?.toString()).toBe('{"openapi":"3.0.0"}');
	});

	it('finds the sole cached version when none is named', async () => {
		await writeVendoredSpec('acme', '9.9.9', Buffer.from('{"openapi":"3.1.0"}'));
		expect((await readVendoredSpec('acme'))?.toString()).toBe('{"openapi":"3.1.0"}');
	});

	it('returns null for a vendor that was never cached', async () =>
		expect(await readVendoredSpec('nobody')).toBeNull());
});
