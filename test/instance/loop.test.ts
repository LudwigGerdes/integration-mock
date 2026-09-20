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
let workflowId: string | undefined;

beforeAll(async () => {
	if (instance === undefined) return;
	inst = instance;
	await assertReachable(inst);
	const info = JSON.parse(await readFile(join(mockHome(), 'proxy.json'), 'utf8')) as {
		adminPort: number;
		token?: string;
	};
	admin = new AdminClient(`http://127.0.0.1:${info.adminPort}`, info.token);
});

afterAll(async () => {
	if (workflowId !== undefined) await deleteWorkflow(inst, workflowId);
});

describeInstance('documented loop, against a real n8n', () => {
	it('serves a workflow HTTP call from the mock and logs it', async () => {
		await admin.setEnabledPacks(['weather']);
		await admin.setMode('replay');
		await admin.clearLog();

		const path = `integration-mock-${randomUUID()}`;
		const created = await createWorkflow(
			inst,
			uncredentialedWorkflow(
				'integration-mock instance test',
				'https://api.example.com/dev/weather',
				path,
			),
		);
		workflowId = created.id;

		await publishWorkflow(inst, created.id);
		const res = await triggerWebhook(inst, path);

		const log = await admin.getLog({ service: 'weather' });

		// Assert traffic first: an empty log localises the failure to
		// interception (n8n missing the proxy env vars, or not restarted since
		// they were set) rather than to the workflow or the pack.
		expect(
			log.length,
			`the mock saw no traffic — webhook returned ${res.status}: ${res.body.slice(0, 300)}`,
		).toBeGreaterThan(0);

		// The mock's own payload should have come back through the workflow.
		expect(res.status).toBe(200);
		expect(res.body).toContain('Evanston');
		expect(log[0]).toMatchObject({ method: 'GET', path: '/dev/weather', status: 200 });
	});
});
