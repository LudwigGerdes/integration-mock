import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { OpenApiDoc } from './generate/openapi.js';

/**
 * Root of the vendored-spec cache: `~/.integration-mock/vendor-specs/`, or under
 * `INTEGRATION_MOCK_HOME` when set (the same root the rest of integration-mock uses, so a test can
 * point everything at one temp dir). Specs are cached outside the package so
 * a rebuild works offline and a refresh only re-downloads what changed.
 */
export const specCacheHome = (): string =>
	process.env.INTEGRATION_MOCK_HOME ?? join(homedir(), '.integration-mock');

export const vendorSpecDir = (vendor: string, version: string): string =>
	join(specCacheHome(), 'vendor-specs', vendor, version);

/** Gzipped: vendor specs run to megabytes and the cache holds many versions. */
export const specPath = (vendor: string, version: string): string =>
	join(vendorSpecDir(vendor, version), 'openapi.json.gz');

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** JSON first — most specs are JSON, and it parses far faster than the YAML path. */
export function parseSpec(bytes: Buffer): OpenApiDoc {
	const text = bytes.toString('utf8');
	try {
		return JSON.parse(text) as OpenApiDoc;
	} catch {
		return parse(text) as OpenApiDoc;
	}
}

/** The version a spec calls itself, used as its cache key. */
export const specVersionOf = (doc: OpenApiDoc): string => doc.info?.version ?? 'unknown';

/**
 * Read a cached spec. With no version, take the newest cached one — callers
 * that care about a specific version record it in `sources.yaml`.
 */
export async function readVendoredSpec(vendor: string, version?: string): Promise<Buffer | null> {
	let resolved = version;
	if (resolved === undefined) {
		try {
			const versions = (await readdir(join(specCacheHome(), 'vendor-specs', vendor))).sort();
			resolved = versions[versions.length - 1];
		} catch {
			return null;
		}
	}
	if (resolved === undefined) return null;
	try {
		return gunzipSync(await readFile(specPath(vendor, resolved)));
	} catch {
		return null;
	}
}

export async function writeVendoredSpec(
	vendor: string,
	version: string,
	bytes: Buffer,
): Promise<void> {
	await mkdir(vendorSpecDir(vendor, version), { recursive: true });
	await writeFile(specPath(vendor, version), gzipSync(bytes, { level: 9 }));
}
