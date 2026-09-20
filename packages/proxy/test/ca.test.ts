import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { ensureCA, leafCertFor } from '../src/ca.js';

describe('ca', () => {
	it('creates once and reuses', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ca-'));
		const a = await ensureCA(dir);
		const b = await ensureCA(dir);
		expect(a.certPem).toBe(b.certPem);
		expect(a.certPath).toBe(join(dir, 'ca.pem'));
		const cert = forge.pki.certificateFromPem(a.certPem);
		expect(cert.subject.getField('CN').value).toBe('integration-mock local CA');
		expect(cert.getExtension('basicConstraints')).toMatchObject({ cA: true });
	});

	it('mints leaf signed by CA with SAN and caches', async () => {
		const ca = await ensureCA(mkdtempSync(join(tmpdir(), 'ca-')));
		const leaf = leafCertFor('api.slack.com', ca);
		const cert = forge.pki.certificateFromPem(leaf.certPem);
		const san = cert.getExtension('subjectAltName') as { altNames: Array<{ value: string }> };
		expect(san.altNames.map((a) => a.value)).toEqual(['api.slack.com']);
		expect(forge.pki.certificateFromPem(ca.certPem).verify(cert)).toBe(true);
		expect(leafCertFor('api.slack.com', ca)).toBe(leaf);
	});
});
