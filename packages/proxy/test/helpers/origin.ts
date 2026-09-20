import { createServer } from 'node:https';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCA, leafCertFor } from '../../src/ca.js';

export interface Origin {
	port: number;
	seen: string[];
	caPem: string;
	close(): Promise<void>;
}

/** A throwaway HTTPS origin with its own CA, standing in for a real vendor host. */
export async function startOrigin(): Promise<Origin> {
	const ca = await ensureCA(mkdtempSync(join(tmpdir(), 'origin-ca-')));
	const leaf = leafCertFor('localhost', ca);
	const seen: string[] = [];
	const srv = createServer({ cert: leaf.certPem, key: leaf.keyPem }, (req, res) => {
		seen.push(`${req.method} ${req.url}`);
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ from: 'origin', path: req.url }));
	});
	await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
	return {
		port: (srv.address() as { port: number }).port,
		seen,
		caPem: ca.certPem,
		close: () => new Promise<void>((r) => srv.close(() => r())),
	};
}
