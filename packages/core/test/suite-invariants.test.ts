import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUPPORTED_N8N_VERSION, SUPPORTED_N8N_WORKFLOW_VERSION } from '../src/version.js';

const pkg = (p: string): { dependencies?: Record<string, string> } =>
	JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as {
		dependencies?: Record<string, string>;
	};

describe('pinned n8n version', () => {
	it('pins n8n-workflow exactly, IF it is a dependency at all', () => {
		const dep = pkg('../package.json').dependencies?.['n8n-workflow'];

		// It is deliberately absent: nothing imported it, so it was 7.3MB carried
		// for a version number, which version.ts records instead. The guard stays
		// conditional rather than deleted — the day something does import it, a
		// caret would let two tools resolve different minors, disagree about node
		// parameter shapes, and surface that as mysterious mismatches rather than
		// a version error.
		if (dep === undefined) return;

		expect(dep).toMatch(/^\d+\.\d+\.\d+$/);
		// The library version, not the app version: n8n@2.38.3 ships
		// n8n-workflow@2.38.1. Identity held only in the 2.10 era.
		expect(dep).toBe(SUPPORTED_N8N_WORKFLOW_VERSION);
	});

	it('declares both versions for other tools to compare against', () => {
		// Shape only. The values are literals here by necessity, so asserting them
		// against literals proves nothing and breaks on every retarget.
		expect(SUPPORTED_N8N_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(SUPPORTED_N8N_WORKFLOW_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
