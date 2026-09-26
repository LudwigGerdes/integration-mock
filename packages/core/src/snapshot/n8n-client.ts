import { fetch as undiciFetch, type Dispatcher } from 'undici';
import type { Instance } from '../config.js';

export interface N8nNode {
	name: string;
	type: string;
	typeVersion: number;
	parameters: Record<string, unknown>;
	credentials?: unknown;
	position?: [number, number];
}

export interface N8nWorkflow {
	id: string;
	name: string;
	nodes: N8nNode[];
	connections: unknown;
	versionId?: string;
	active?: boolean;
}

export interface N8nRunItem {
	data?: { main?: Array<Array<{ json: unknown; pairedItem?: unknown }>> };
	error?: unknown;
	startTime?: number;
	executionTime?: number;
}

export interface N8nExecution {
	id: string;
	workflowId: string;
	status: string;
	workflowData: N8nWorkflow;
	data: { resultData: { runData: Record<string, N8nRunItem[]> } };
	startedAt?: string;
	stoppedAt?: string;
	mode?: string;
}

/**
 * Read-only client for n8n's public REST API.
 *
 * Snapshotting only ever reads: the tool never mutates a workflow, so a
 * read-scoped API key is enough.
 */
export class N8nClient {
	private base: string;

	constructor(
		private inst: Instance,
		private dispatcher?: Dispatcher,
	) {
		this.base = inst.url.replace(/\/+$/, '');
	}

	private async get<T>(path: string): Promise<T> {
		const r = await undiciFetch(this.base + path, {
			headers: { 'X-N8N-API-KEY': this.inst.apiKey, accept: 'application/json' },
			dispatcher: this.dispatcher,
		});
		if (!r.ok) throw new Error(`n8n GET ${path} → ${r.status}`);
		return (await r.json()) as T;
	}

	getExecution(id: string): Promise<N8nExecution> {
		return this.get(`/api/v1/executions/${encodeURIComponent(id)}?includeData=true`);
	}

	/**
	 * The newest execution, whatever its status.
	 *
	 * Deliberately unfiltered: a retry that *failed* is exactly the case `diff`
	 * exists to explain, and filtering to successful runs would silently compare
	 * against an older passing execution and report that nothing changed.
	 */
	async getLatestExecution(workflowId?: string): Promise<N8nExecution> {
		const q = new URLSearchParams({ limit: '1' });
		if (workflowId !== undefined) q.set('workflowId', workflowId);
		const list = await this.get<{ data: Array<{ id: string }> }>(`/api/v1/executions?${q.toString()}`);
		const first = list.data[0];
		if (!first) throw new Error('no successful executions found');
		return this.getExecution(first.id);
	}

	getWorkflow(id: string): Promise<N8nWorkflow> {
		return this.get(`/api/v1/workflows/${encodeURIComponent(id)}`);
	}
}
