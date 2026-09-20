import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUPPORTED_N8N_VERSION } from '../src/version.js';
import type { N8nExecution } from '../src/snapshot/n8n-client.js';
import { outputsOf } from '../src/snapshot/build.js';

const load = (n: string): N8nExecution =>
	JSON.parse(
		readFileSync(new URL(`../../../conformance/executions/${n}.json`, import.meta.url), 'utf8'),
	) as N8nExecution;

describe('S4 conformance — execution exports', () => {
	// These fixtures were captured from n8n 2.10.0. The execution-JSON shape S4
	// depends on is version-stable, so the structural checks below still hold, but
	// the exports should be recaptured from an instance running the pinned version
	// so provenance matches the pin.
	it.todo('recapture S4 execution exports from the pinned n8n version (currently 2.10.0-era)');
	it('the suite declares a pinned version', () =>
		expect(SUPPORTED_N8N_VERSION).toMatch(/^\d+\.\d+\.\d+$/));

	for (const name of ['success', 'error', 'multi-run']) {
		it(`${name} carries the fields S4 promises`, () => {
			const e = load(name) as N8nExecution & { mode?: string; startedAt?: string };
			// Consumers (canvas, payload-contract) rely on exactly these.
			expect(typeof e.id).toBe('string');
			expect(typeof e.workflowId).toBe('string');
			expect(e.status).toBeDefined();
			expect(e.mode).toBe('manual');
			expect(typeof e.startedAt).toBe('string');
			expect(Array.isArray(e.workflowData.nodes)).toBe(true);
			expect(e.data.resultData.runData).toBeTypeOf('object');
		});
	}

	it('success ran every node once', () => {
		const e = load('success');
		expect(e.status).toBe('success');
		expect(outputsOf(e, 'Edit Fields')).toHaveLength(1);
	});

	it('error records the failure rather than merely stopping', () => {
		const e = load('error') as N8nExecution & {
			data: { resultData: { error?: { message?: string } } };
		};
		expect(e.status).toBe('error');
		expect(e.data.resultData.error?.message).toContain('deliberate failure');
		// The failing node produces no output — what diff reports as items going to zero.
		expect(outputsOf(e, 'Boom')).toHaveLength(0);
	});

	it('multi-run has a node with several runs, not several items in one run', () => {
		const e = load('multi-run');
		// This is the distinction the fixture exists to pin down: outputsOf must
		// flatten across runs, and a consumer that reads only run[0] is wrong.
		expect(e.data.resultData.runData['Per Item']).toHaveLength(3);
		expect(outputsOf(e, 'Per Item')).toHaveLength(3);
	});
});
