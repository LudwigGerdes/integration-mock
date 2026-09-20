import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSnapshot } from '../../src/snapshot/build.js';
import { deepDiffPaths, diffSnapshot } from '../../src/snapshot/diff.js';
import { __resetMappersForTests } from '../../src/snapshot/mappers.js';
import type { N8nExecution } from '../../src/snapshot/n8n-client.js';
import type { LogEntry } from '../../src/types.js';

const load = (n: string): N8nExecution =>
	JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), 'utf8')) as N8nExecution;

const entry = (o: Partial<LogEntry>): LogEntry => ({
	id: 'x',
	ts: 1,
	service: 'api-example-com',
	method: 'GET',
	url: 'u',
	path: '/users',
	query: { page: '1' },
	reqHeaders: {},
	status: 200,
	resHeaders: {},
	latencyMs: 1,
	matchedRoute: 'r',
	...o,
});

describe('deepDiffPaths', () => {
	it('reports changed, added, removed, array index', () => {
		expect(
			deepDiffPaths({ a: 1, b: { c: 2 }, l: [1, 2] }, { a: 1, b: { c: 3 }, d: 4, l: [1] }).sort(),
		).toEqual(['b.c', 'd', 'l[1]']);
		expect(deepDiffPaths([{ x: 1 }], [{ x: 1 }])).toEqual([]);
	});
});

describe('diffSnapshot', () => {
	beforeEach(() => __resetMappersForTests());

	it('detects edited nodes, removed node, output changes', () => {
		const base = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		const d = diffSnapshot(base, load('execution-edited'), []);
		expect(d.changedNodes.sort()).toEqual(['Fetch Users', 'Notify', 'Pick Fields']);
		expect(d.nodeOutputs['Fetch Users']).toMatchObject({ itemsBefore: 2, itemsAfter: 1 });
		expect(d.nodeOutputs['Notify']).toMatchObject({ itemsBefore: 2, itemsAfter: 0 });
		expect(d.nodeOutputs['Pick Fields']!.changedPaths).toContain('[0].email');
	});

	it('calls: missing when the snapshot route was never hit; added for new; unmatched passthrough', () => {
		const base = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		const log = [
			entry({ path: '/users', query: { page: '2' }, matchedRoute: 'unmatched' }),
			entry({ service: 'hub', path: '/v1/new', matchedRoute: 'hub:GET:/v1/new#0' }),
		];
		const d = diffSnapshot(base, load('execution-edited'), log);
		expect(d.calls.missing.map((r) => r.id)).toEqual(['api-example-com:GET:/users#0']);
		expect(d.calls.unmatched).toHaveLength(1);
		expect(d.calls.added.map((e) => e.path)).toEqual(['/v1/new']);
	});

	it('calls: changed body', () => {
		const base = buildSnapshot(load('execution-basic'), { instance: 'dev' });
		const b2 = structuredClone(base);
		b2.packs[0]!.routes[0]!.match = { method: 'POST', path: '/users', bodyMatch: { a: 1 } };
		const d = diffSnapshot(b2, load('execution-basic'), [
			entry({ method: 'POST', path: '/users', query: {}, reqBody: { a: 2 } }),
		]);
		expect(d.calls.changed[0]!.bodyDiff).toEqual(['a']);
	});
});
