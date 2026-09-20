import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from '../src/version.js';

describe('CLI_VERSION', () => {
	it('matches the published manifest', () => {
		// The constant exists so bundling cannot break a runtime package.json
		// read; this is what stops it silently lying after a release bump.
		const pkg = JSON.parse(
			readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
		) as { version: string };
		expect(CLI_VERSION).toBe(pkg.version);
	});
});
