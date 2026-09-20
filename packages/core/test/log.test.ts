import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestLog } from '../src/log.js';

const entry = (service: string, over: Record<string, unknown> = {}) => ({
	service,
	method: 'GET' as const,
	url: `https://${service}/x`,
	path: '/x',
	query: {},
	reqHeaders: {},
	status: 200,
	resHeaders: {},
	latencyMs: 1,
	matchedRoute: 'r',
	...over,
});

describe('RequestLog', () => {
	it('assigns id/ts and filters', () => {
		const log = new RequestLog();
		const a = log.append(entry('slack'));
		log.append(entry('sheets'));
		log.append(entry('slack'));
		expect(a.id).toBeTruthy();
		expect(a.ts).toBeGreaterThan(0);
		expect(log.list({ service: 'slack' })).toHaveLength(2);
		expect(log.list({ limit: 1 })[0]!.service).toBe('slack');
		expect(log.list({ since: a.ts + 1_000_000 })).toHaveLength(0);
	});

	it('ring buffer drops oldest', () => {
		const log = new RequestLog({ max: 2 });
		log.append(entry('a'));
		log.append(entry('b'));
		log.append(entry('c'));
		expect(log.list().map((e) => e.service)).toEqual(['b', 'c']);
	});

	it('clear', () => {
		const l = new RequestLog();
		l.append(entry('a'));
		l.clear();
		expect(l.list()).toHaveLength(0);
	});

	it('writes JSONL file', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'n8nmock-'));
		const file = join(dir, 'log.jsonl');
		const log = new RequestLog({ file });
		log.append(entry('a'));
		await log.flush();
		expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
	});
});
