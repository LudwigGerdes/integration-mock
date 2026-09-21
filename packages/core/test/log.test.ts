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

	it('redacts credentials in the file, and keeps the in-memory entry as sent', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'n8nmock-'));
		const file = join(dir, 'log.jsonl');
		const log = new RequestLog({ file, redactPaths: ['reqBody.customer.email'] });
		const kept = log.append({
			...entry('a'),
			reqHeaders: { authorization: 'Bearer sk_live_abcdefghijklmnopqrstuvwxyz', accept: 'application/json' },
			reqBody: { customer: { email: 'ada@example.com', plan: 'pro' } },
		});
		await log.flush();

		const onDisk = readFileSync(file, 'utf8');
		expect(onDisk).not.toContain('sk_live_abcdefghijklmnopqrstuvwxyz');
		expect(onDisk).not.toContain('ada@example.com');
		const written = JSON.parse(onDisk) as { reqHeaders: Record<string, string>; reqBody: { customer: { plan: string } } };
		expect(written.reqHeaders.authorization).toBe('[REDACTED]');
		expect(written.reqHeaders.accept).toBe('application/json');
		expect(written.reqBody.customer.plan).toBe('pro');

		// Snapshot diffing and recording read the entry in memory and need it whole.
		expect(kept.reqHeaders.authorization).toBe('Bearer sk_live_abcdefghijklmnopqrstuvwxyz');
	});
});
