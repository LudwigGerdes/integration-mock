import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mockHome } from 'integration-mock-core';
import { AdminClient } from 'integration-mock-proxy';
import { assertReachable, resolveInstance, type TargetInstance } from './helpers/instance.js';
import {
	createWorkflow,
	deleteWorkflow,
	publishWorkflow,
	triggerWebhook,
	uncredentialedWorkflow,
} from './helpers/n8n.js';

const instance = await resolveInstance();
const describeInstance = instance === undefined ? describe.skip : describe;

let inst: TargetInstance;
let admin: AdminClient;
let proxyPort: number;
let workflowId: string | undefined;

beforeAll(async () => {
	if (instance === undefined) return;
	inst = instance;
	await assertReachable(inst);
	const info = JSON.parse(await readFile(join(mockHome(), 'proxy.json'), 'utf8')) as {
		port: number;
		adminPort: number;
		token?: string;
	};
	proxyPort = info.port;
	admin = new AdminClient(`http://127.0.0.1:${info.adminPort}`, info.token);
});

afterAll(async () => {
	if (workflowId !== undefined) await deleteWorkflow(inst, workflowId);
});

describeInstance('base-URL mode, against a real n8n', () => {
	it('serves a workflow pointed straight at the mock, with no proxy env', async () => {
		await admin.setEnabledPacks(['weather']);
		// Deliberately `off`: base-URL must not depend on interception being on.
		await admin.setMode('off');
		await admin.clearLog();

		const path = `integration-mock-burl-${randomUUID()}`;
		const created = await createWorkflow(
			inst,
			uncredentialedWorkflow(
				'integration-mock base-url test',
				`http://127.0.0.1:${proxyPort}/weather/dev/weather`,
				path,
			),
		);
		workflowId = created.id;

		await publishWorkflow(inst, created.id);
		const res = await triggerWebhook(inst, path);

		const log = await admin.getLog({ service: 'weather' });
		expect(
			log.length,
			`mock saw no traffic — webhook returned ${res.status}: ${res.body.slice(0, 300)}`,
		).toBeGreaterThan(0);
		expect(res.status).toBe(200);
		expect(res.body).toContain('Evanston');
		expect(log[0]).toMatchObject({ method: 'GET', path: '/dev/weather', status: 200 });
	});
});
