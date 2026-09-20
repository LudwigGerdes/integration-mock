import { request } from 'undici';
import type { CredentialSchema } from 'integration-mock-core';

export interface CreatedCredential {
	id: string;
	name: string;
}

export interface CredsClient {
	schema(type: string): Promise<CredentialSchema>;
	create(body: {
		name: string;
		type: string;
		data: Record<string, unknown>;
	}): Promise<CreatedCredential>;
}

/**
 * Talks to the user's own n8n, not to any third party.
 *
 * Isolated here so the network-I/O rule in CLAUDE.md stays a list of named
 * modules rather than a claim nobody can check.
 */
export function realCredsClient(baseUrl: string, apiKey: string): CredsClient {
	const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
		const res = await request(new URL(path, baseUrl).toString(), {
			method: method as 'GET',
			headers: { 'content-type': 'application/json', 'X-N8N-API-KEY': apiKey },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.body.text();
		if (res.statusCode >= 400) {
			throw new Error(`n8n ${method} ${path} -> ${res.statusCode} ${text.slice(0, 200)}`);
		}
		return JSON.parse(text) as T;
	};

	return {
		schema: (type) => call<CredentialSchema>('GET', `/api/v1/credentials/schema/${type}`),
		create: (body) => call<CreatedCredential>('POST', '/api/v1/credentials', body),
	};
}
