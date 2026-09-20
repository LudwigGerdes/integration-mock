import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSnapshot, hashNode, hashWorkflow, snapshotPath } from '../../src/snapshot/build.js';
import { __resetMappersForTests } from '../../src/snapshot/mappers.js';
import type { N8nExecution } from '../../src/snapshot/n8n-client.js';

const load = (n: string): N8nExecution =>
	JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), 'utf8')) as N8nExecution;

describe('buildSnapshot', () => {
	// The packs' mappers may be registered by other suites; these assertions are
	// about core's own behaviour with only the built-in HTTP Request mapper.
	beforeEach(() => __resetMappersForTests());

	it('metadata', () => {
		const snap = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		expect(snap).toMatchObject({ executionId: '4123', workflowId: '8f3a', instance: 'dev' });
		expect(Object.keys(snap.nodeHashes).sort()).toEqual([
			'Fetch Users',
			'Manual Trigger',
			'Notify',
			'Pick Fields',
		]);
	});

	it('HTTP Request → pack with route', () => {
		const snap = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		const pack = snap.packs.find((p) => p.id === 'api-example-com')!;
		expect(pack).toMatchObject({
			domains: ['api.example.com'],
			prefix: '/api-example-com',
			source: 'snapshot:4123',
		});
		expect(pack.routes[0]!.match).toEqual({
			method: 'GET',
			path: '/users',
			query: { page: '1' },
		});
		expect(pack.routes[0]!.respond!.body).toEqual([
			{ id: 1, email: 'a@example.com' },
			{ id: 2, email: 'b@example.com' },
		]);
	});

	it('Slack without mapper → warning, no pack; ignored nodes silent', () => {
		const snap = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		expect(snap.warnings).toEqual([
			'Notify (n8n-nodes-base.slack): no reverse-mapper; library defaults will serve',
		]);
		expect(snap.packs.map((p) => p.id)).toEqual(['api-example-com']);
	});

	it('nodeOutputs kept', () => {
		const snap = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		expect(snap.nodeOutputs['Pick Fields']).toEqual([
			{ email: 'a@example.com' },
			{ email: 'b@example.com' },
		]);
	});

	it('redaction leaves hashes intact', () => {
		const snap = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		// sha256 hex is token-shaped; redaction must not touch integrity metadata.
		expect(snap.workflowHash).toMatch(/^[a-f0-9]{64}$/);
		for (const h of Object.values(snap.nodeHashes)) expect(h).toMatch(/^[a-f0-9]{64}$/);
	});

	it('redaction applies', () => {
		const e = load('execution-basic');
		(e.data.resultData.runData['Fetch Users']![0]!.data!.main![0]![0]!.json as Record<
			string,
			unknown
		>).token = 'xoxb-0123456789abcdefghijk';
		expect(
			(buildSnapshot(e, { instance: 'dev' }).nodeOutputs['Fetch Users']![0] as { token: string })
				.token,
		).toBe('[REDACTED]');
	});
});

describe('hashes', () => {
	it('stable and position-insensitive; node hash changes on params', () => {
		const a = load('execution-basic').workflowData;
		const b = load('execution-basic').workflowData;
		b.nodes[1]!.position = [999, 999];
		expect(hashWorkflow(a)).toBe(hashWorkflow(b));
		const edited = load('execution-edited').workflowData;
		expect(hashNode(a.nodes[1]!)).not.toBe(hashNode(edited.nodes[1]!));
		expect(hashNode(a.nodes[0]!)).toBe(hashNode(edited.nodes[0]!));
	});

	it('snapshotPath', () =>
		expect(snapshotPath('8f3a', '4123', '/proj')).toBe('/proj/.integration-mock/snapshots/8f3a/4123.json'));
});
