import type { TargetInstance } from './instance.js';

interface CreatedWorkflow {
	id: string;
	name: string;
}

const api = (inst: TargetInstance, path: string): string => new URL(path, inst.url).toString();

async function call<T>(
	inst: TargetInstance,
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(api(inst, path), {
		method,
		headers: { 'content-type': 'application/json', 'X-N8N-API-KEY': inst.apiKey },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`n8n ${method} ${path} → ${res.status} ${await res.text()}`);
	const text = await res.text();
	return (text === '' ? undefined : JSON.parse(text)) as T;
}

/**
 * A Webhook → HTTP Request workflow with no credential.
 *
 * Webhook rather than Manual Trigger: the 2.38 public API has no run/execute
 * endpoint, and `/rest/workflows/:id/run` needs a browser session cookie that
 * an API key cannot supply. Publishing and hitting the production webhook keeps
 * the whole loop on the public API.
 *
 * No credential is deliberate: a workflow referencing a credential id that does
 * not exist on the target instance fails before any HTTP call is made, so the
 * mock would never be reached.
 */
export function uncredentialedWorkflow(name: string, url: string, path: string): unknown {
	return {
		name,
		settings: {},
		nodes: [
			{
				id: 'trigger',
				name: 'Webhook',
				type: 'n8n-nodes-base.webhook',
				typeVersion: 2,
				position: [0, 0],
				webhookId: path,
				parameters: { path, httpMethod: 'GET', responseMode: 'lastNode', options: {} },
			},
			{
				id: 'fetch',
				name: 'Fetch',
				type: 'n8n-nodes-base.httpRequest',
				typeVersion: 4.2,
				position: [220, 0],
				parameters: { url, options: {} },
			},
		],
		connections: {
			Webhook: { main: [[{ node: 'Fetch', type: 'main', index: 0 }]] },
		},
	};
}

export function createWorkflow(inst: TargetInstance, wf: unknown): Promise<CreatedWorkflow> {
	return call<CreatedWorkflow>(inst, 'POST', '/api/v1/workflows', wf);
}

export function deleteWorkflow(inst: TargetInstance, id: string): Promise<unknown> {
	return call(inst, 'DELETE', `/api/v1/workflows/${id}`);
}

/** 2.38.3 ships publish/unpublish on the public API (contrary to an older note). */
export function publishWorkflow(inst: TargetInstance, id: string): Promise<unknown> {
	return call(inst, 'POST', `/api/v1/workflows/${id}/publish`, {});
}

/** Fire the production webhook and return what the workflow responded with. */
export async function triggerWebhook(
	inst: TargetInstance,
	path: string,
): Promise<{ status: number; body: string }> {
	const res = await fetch(new URL(`/webhook/${path}`, inst.url));
	return { status: res.status, body: await res.text() };
}
