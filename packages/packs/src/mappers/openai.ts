import type { ReverseMapper, Route } from 'integration-mock-core';

const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const rl = (v: unknown): string | undefined => {
	const o = v as { value?: unknown } | undefined;
	const s = o?.value ?? v;
	return typeof s === 'string' && !s.startsWith('=') ? s : undefined;
};

const ZERO_USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/**
 * The node emits either the raw choice (`{message, index, finish_reason}`) or,
 * when simplified, just the text — both reverse to the same completion envelope.
 */
function chatRoute(model: string, outputs: unknown[]): Route {
	return {
		id: 'openai:POST:/v1/chat/completions#0',
		match: { method: 'POST', path: '/v1/chat/completions' },
		respond: {
			status: 200,
			body: {
				id: 'chatcmpl-mock',
				object: 'chat.completion',
				created: 0,
				model,
				choices: outputs.map((o, i) => {
					const item = obj(o);
					const message = item.message ?? {
						role: 'assistant',
						content: item.content ?? item.text ?? '',
					};
					return {
						index: i,
						message,
						finish_reason: typeof item.finish_reason === 'string' ? item.finish_reason : 'stop',
					};
				}),
				usage: ZERO_USAGE,
			},
		},
	};
}

function embeddingRoute(model: string, outputs: unknown[]): Route {
	return {
		id: 'openai:POST:/v1/embeddings#0',
		match: { method: 'POST', path: '/v1/embeddings' },
		respond: {
			status: 200,
			body: {
				object: 'list',
				data: outputs.map((o, i) => ({
					object: 'embedding',
					index: i,
					embedding: obj(o).embedding ?? [],
				})),
				model,
				usage: ZERO_USAGE,
			},
		},
	};
}

/** The OpenAI node ships under two type ids; one behaviour, registered twice. */
const forNodeType = (nodeType: string): ReverseMapper => ({
	nodeType,
	service: 'openai',
	domains: ['api.openai.com'],
	fromNodeOutput(node, outputs) {
		const { resource, operation } = node.parameters as { resource?: string; operation?: string };
		const key = `${String(resource)}/${String(operation)}`;
		const model = rl(node.parameters.modelId) ?? 'gpt-4o-mini';

		if (key === 'text/message') return [chatRoute(model, outputs)];
		if (key === 'text/embedding' || String(operation) === 'embedding') {
			return [embeddingRoute(model, outputs)];
		}
		return [];
	},
});

export const openAiMappers: ReverseMapper[] = [
	forNodeType('@n8n/n8n-nodes-langchain.openAi'),
	forNodeType('n8n-nodes-base.openAi'),
];
