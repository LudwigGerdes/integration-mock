import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { N8nNode } from 'integration-mock-core';
import { openAiMappers } from '../../src/mappers/openai.js';
import { serveThrough } from '../helpers/serve.js';

const fx = JSON.parse(
	readFileSync(new URL('../fixtures/openai.node-output.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;

const langchain = openAiMappers.find((m) => m.nodeType === '@n8n/n8n-nodes-langchain.openAi')!;
const base = openAiMappers.find((m) => m.nodeType === 'n8n-nodes-base.openAi')!;

const node = (type: string, resource: string, operation: string): N8nNode => ({
	name: 'OpenAI',
	type,
	typeVersion: 1.8,
	parameters: { resource, operation },
});

describe('openai mapper', () => {
	it('registers under both node types', () => {
		expect(openAiMappers.map((m) => m.nodeType).sort()).toEqual([
			'@n8n/n8n-nodes-langchain.openAi',
			'n8n-nodes-base.openAi',
		]);
	});

	it('chat completion envelope', () => {
		const routes = langchain.fromNodeOutput(
			node('@n8n/n8n-nodes-langchain.openAi', 'text', 'message'),
			fx['text/message']!,
		);
		const res = serveThrough('openai', routes, {
			method: 'POST',
			path: '/v1/chat/completions',
		});
		const body = res.body as {
			object: string;
			choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
		};
		expect(body.object).toBe('chat.completion');
		expect(body.choices[0]!.message.content).toBe('Hello!');
		expect(body.choices[0]!.finish_reason).toBe('stop');
	});

	it('simplified output gets an assistant role', () => {
		const routes = base.fromNodeOutput(node('n8n-nodes-base.openAi', 'text', 'message'), fx.simplified!);
		const body = serveThrough('openai', routes, { method: 'POST', path: '/v1/chat/completions' })
			.body as { choices: Array<{ message: { role: string; content: string } }> };
		expect(body.choices[0]!.message).toEqual({ role: 'assistant', content: 'Hi' });
	});

	it('embeddings envelope', () => {
		const routes = base.fromNodeOutput(node('n8n-nodes-base.openAi', 'text', 'embedding'), fx.embedding!);
		const body = serveThrough('openai', routes, { method: 'POST', path: '/v1/embeddings' }).body as {
			object: string;
			data: Array<{ embedding: number[] }>;
		};
		expect(body.object).toBe('list');
		expect(body.data[0]!.embedding).toEqual([0.1, 0.2, 0.3]);
	});

	it('unsupported → []', () =>
		expect(base.fromNodeOutput(node('n8n-nodes-base.openAi', 'image', 'generate'), [{}])).toEqual([]));
});
