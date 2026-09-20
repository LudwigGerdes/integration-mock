import forge from 'node-forge';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockHome } from 'integration-mock-core';

export interface CA {
	certPem: string;
	keyPem: string;
	certPath: string;
}

const inYears = (n: number): Date => {
	const d = new Date();
	d.setFullYear(d.getFullYear() + n);
	return d;
};

function baseCert(pub: forge.pki.PublicKey, serialSeed: string): forge.pki.Certificate {
	const cert = forge.pki.createCertificate();
	cert.publicKey = pub;
	cert.serialNumber = forge.md.sha1
		.create()
		.update(serialSeed + String(Date.now()))
		.digest()
		.toHex()
		.slice(0, 16);
	cert.validity.notBefore = new Date(Date.now() - 60_000);
	return cert;
}

/**
 * Load the local CA, generating it on first use.
 *
 * n8n trusts this CA via `NODE_EXTRA_CA_CERTS`; it never leaves the machine
 * and only ever signs leaves for hosts the proxy is actively intercepting.
 */
export async function ensureCA(dir: string = mockHome()): Promise<CA> {
	const certPath = join(dir, 'ca.pem');
	const keyPath = join(dir, 'ca-key.pem');
	try {
		const [certPem, keyPem] = await Promise.all([
			readFile(certPath, 'utf8'),
			readFile(keyPath, 'utf8'),
		]);
		return { certPem, keyPem, certPath };
	} catch {
		// not generated yet
	}

	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = baseCert(keys.publicKey, 'ca');
	cert.validity.notAfter = inYears(10);
	const subject = [
		{ name: 'commonName', value: 'integration-mock local CA' },
		{ name: 'organizationName', value: 'integration-mock' },
	];
	cert.setSubject(subject);
	cert.setIssuer(subject);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: true, critical: true },
		{ name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
		{ name: 'subjectKeyIdentifier' },
	]);
	cert.sign(keys.privateKey, forge.md.sha256.create());

	const certPem = forge.pki.certificateToPem(cert);
	const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
	await mkdir(dir, { recursive: true });
	await Promise.all([
		writeFile(certPath, certPem),
		writeFile(keyPath, keyPem, { mode: 0o600 }),
	]);
	return { certPem, keyPem, certPath };
}

export interface Leaf {
	certPem: string;
	keyPem: string;
}

/** Keyed by CA fingerprint + host: two CAs in one process must not share leaves. */
const cache = new Map<string, Leaf>();

const caId = (certPem: string): string =>
	forge.md.sha1.create().update(certPem).digest().toHex().slice(0, 12);
const MAX_CACHED = 200;
/** One RSA keypair for every leaf — key generation, not signing, is the slow part. */
let leafKeys: forge.pki.rsa.KeyPair | undefined;

/** Mint (and cache) a server certificate for `host`, signed by the local CA. */
export function leafCertFor(host: string, ca: { certPem: string; keyPem: string }): Leaf {
	const key = `${caId(ca.certPem)}:${host}`;
	const hit = cache.get(key);
	if (hit) return hit;

	leafKeys ??= forge.pki.rsa.generateKeyPair(2048);
	const caCert = forge.pki.certificateFromPem(ca.certPem);
	const caKey = forge.pki.privateKeyFromPem(ca.keyPem);

	const cert = baseCert(leafKeys.publicKey, host);
	cert.validity.notAfter = inYears(1);
	cert.setSubject([{ name: 'commonName', value: host }]);
	cert.setIssuer(caCert.subject.attributes);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: false },
		{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
		{ name: 'extKeyUsage', serverAuth: true },
		{ name: 'subjectAltName', altNames: [{ type: 2, value: host }] },
		{
			name: 'authorityKeyIdentifier',
			// Must identify the CA's key, not the leaf's — `keyIdentifier: true` would
			// derive it from this certificate and break chain building in OpenSSL.
			keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes(),
			authorityCertIssuer: caCert.issuer,
			serialNumber: caCert.serialNumber,
		},
	]);
	cert.sign(caKey, forge.md.sha256.create());

	const leaf: Leaf = {
		certPem: forge.pki.certificateToPem(cert),
		keyPem: forge.pki.privateKeyToPem(leafKeys.privateKey),
	};
	if (cache.size >= MAX_CACHED) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(key, leaf);
	return leaf;
}
