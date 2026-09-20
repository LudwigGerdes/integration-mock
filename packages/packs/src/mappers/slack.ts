import type { ReverseMapper, Route } from 'integration-mock-core';

/** n8n resource-locator value, when it is a literal rather than an expression. */
const rl = (v: unknown): string | undefined => {
	const o = v as { value?: unknown } | undefined;
	return typeof o?.value === 'string' && !o.value.startsWith('=') ? o.value : undefined;
};

export const slackMapper: ReverseMapper = {
	nodeType: 'n8n-nodes-base.slack',
	service: 'slack',
	domains: ['slack.com', '*.slack.com'],
	fromNodeOutput(node, outputs) {
		const { resource, operation } = node.parameters as { resource?: string; operation?: string };
		const key = `${String(resource)}/${String(operation)}`;

		if (key === 'message/post') {
			const channel = rl(node.parameters.channelId);
			return outputs.map(
				(o, i): Route => ({
					id: `slack:POST:/api/chat.postMessage#${i}`,
					match: {
						method: 'POST',
						path: '/api/chat.postMessage',
						...(channel !== undefined ? { bodyMatch: { channel } } : {}),
					},
					respond: { status: 200, body: o },
				}),
			);
		}

		if (key === 'channel/getAll') {
			return [
				{
					id: 'slack:GET:/api/conversations.list#0',
					match: { method: 'GET', path: '/api/conversations.list' },
					respond: {
						status: 200,
						body: { ok: true, channels: outputs, response_metadata: { next_cursor: '' } },
					},
				},
			];
		}

		if (key === 'user/info') {
			return [
				{
					id: 'slack:GET:/api/users.info#0',
					match: { method: 'GET', path: '/api/users.info' },
					respond: { status: 200, body: { ok: true, user: outputs[0] } },
				},
			];
		}

		return [];
	},
};
