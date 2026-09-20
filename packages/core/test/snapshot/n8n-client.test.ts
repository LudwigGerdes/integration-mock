import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockAgent } from 'undici';
import { N8nClient } from '../../src/snapshot/n8n-client.js';

const basic: unknown = JSON.parse(
	readFileSync(new URL('../fixtures/execution-basic.json', import.meta.url), 'utf8'),
);
const agent = (): MockAgent => {
	const a = new MockAgent();
	a.disableNetConnect();
	return a;
};

describe('N8nClient', () => {
	it('getExecution with data + api key header', async () => {
		const a = agent();
		a.get('http://n8n.test')
			.intercept({
				path: '/api/v1/executions/4123?includeData=true',
				method: 'GET',
				headers: { 'x-n8n-api-key': 'k' },
			})
			.reply(200, basic);
		const c = new N8nClient({ name: 'dev', url: 'http://n8n.test', apiKey: 'k' }, a);
		expect((await c.getExecution('4123')).workflowData.name).toBe('Users to Slack');
	});

	it('getLatestExecution lists then fetches', async () => {
		const a = agent();
		const pool = a.get('http://n8n.test');
		pool
			.intercept({ path: '/api/v1/executions?limit=1&workflowId=8f3a', method: 'GET' })
			.reply(200, { data: [{ id: '4123' }] });
		pool
			.intercept({ path: '/api/v1/executions/4123?includeData=true', method: 'GET' })
			.reply(200, basic);
		const c = new N8nClient({ name: 'dev', url: 'http://n8n.test/', apiKey: 'k' }, a);
		expect((await c.getLatestExecution('8f3a')).id).toBe('4123');
	});

	it('takes the newest execution even when it failed', async () => {
		// A retry that broke is exactly when diff is reached for; filtering to
		// successful runs would silently diff against an older, passing one.
		const a = agent();
		const pool = a.get('http://n8n.test');
		pool
			.intercept({ path: '/api/v1/executions?limit=1&workflowId=8f3a', method: 'GET' })
			.reply(200, { data: [{ id: '4130', status: 'error' }] });
		pool
			.intercept({ path: '/api/v1/executions/4130?includeData=true', method: 'GET' })
			.reply(200, { ...(basic as object), id: '4130', status: 'error' });
		const c = new N8nClient({ name: 'dev', url: 'http://n8n.test', apiKey: 'k' }, a);
		expect((await c.getLatestExecution('8f3a')).id).toBe('4130');
	});

	it('errors on non-2xx', async () => {
		const a = agent();
		a.get('http://n8n.test').intercept({ path: '/api/v1/workflows/x', method: 'GET' }).reply(401, {});
		await expect(
			new N8nClient({ name: 'd', url: 'http://n8n.test', apiKey: 'k' }, a).getWorkflow('x'),
		).rejects.toThrow(/→ 401/);
	});
});
