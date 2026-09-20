import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	RequestLog,
	FaultController,
	buildSnapshot,
	diffSnapshot,
	type N8nExecution,
} from 'integration-mock-core';
import { registerAllMappers } from 'integration-mock-packs';
import { MockEngine } from '../src/state.js';

const load = (n: string): N8nExecution =>
	JSON.parse(
		readFileSync(new URL(`../../core/test/fixtures/${n}.json`, import.meta.url), 'utf8'),
	) as N8nExecution;

describe('snapshot → replay → diff loop', () => {
	registerAllMappers();

	it('replays the HTTP Request and Slack calls from a snapshot, then diffs an edited run', async () => {
		const log = new RequestLog();
		const engine = new MockEngine({
			packs: { library: [], user: [], project: [], snapshot: [] },
			log,
			faults: new FaultController(),
		});

		const snap = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		engine.activateSnapshot(snap);
		engine.setMode('replay');

		expect(engine.shouldIntercept('api.example.com')).toBe('api-example-com');
		expect(engine.shouldIntercept('slack.com')).toBe('slack');

		const users = await engine.handleReplay('api-example-com', {
			method: 'GET',
			host: 'api.example.com',
			path: '/users',
			query: { page: '1' },
			headers: {},
		});
		expect(users.body).toEqual(snap.nodeOutputs['Fetch Users']);

		const slack = await engine.handleReplay('slack', {
			method: 'POST',
			host: 'slack.com',
			path: '/api/chat.postMessage',
			query: {},
			headers: {},
			body: { channel: 'C123', text: 'x' },
		});
		expect((slack.body as { ok: boolean }).ok).toBe(true);

		// The user edits the workflow to page=2 and re-runs: the new call falls
		// past the snapshot routes and fails loud rather than reaching the vendor.
		const miss = await engine.handleReplay('api-example-com', {
			method: 'GET',
			host: 'api.example.com',
			path: '/users',
			query: { page: '2' },
			headers: {},
		});
		expect(miss.status).toBe(501);

		const d = diffSnapshot(snap, load('execution-edited'), log.list());
		expect(d.changedNodes).toContain('Fetch Users');
		expect(d.calls.unmatched).toHaveLength(1);
		expect(d.nodeOutputs['Notify']).toMatchObject({ itemsBefore: 2, itemsAfter: 0 });
	});
});
