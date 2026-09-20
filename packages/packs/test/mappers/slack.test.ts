import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { N8nNode } from 'integration-mock-core';
import { slackMapper } from '../../src/mappers/slack.js';
import { serveThrough } from '../helpers/serve.js';

const fx = JSON.parse(
	readFileSync(new URL('../fixtures/slack.node-output.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;

const node = (
	resource: string,
	operation: string,
	extra: Record<string, unknown> = {},
): N8nNode => ({
	name: 'Slack',
	type: 'n8n-nodes-base.slack',
	typeVersion: 2.2,
	parameters: { resource, operation, ...extra },
});

describe('slack mapper', () => {
	it('message/post → one route per message with channel bodyMatch', () => {
		const routes = slackMapper.fromNodeOutput(
			node('message', 'post', { channelId: { __rl: true, value: 'C123', mode: 'id' } }),
			fx['message/post']!,
		);
		expect(routes).toHaveLength(2);
		expect(routes[0]!.match).toEqual({
			method: 'POST',
			path: '/api/chat.postMessage',
			bodyMatch: { channel: 'C123' },
		});
		const res = serveThrough('slack', routes, {
			method: 'POST',
			path: '/api/chat.postMessage',
			body: { channel: 'C123', text: 'hi' },
		});
		expect(res.body).toEqual(fx['message/post']![0]);
	});

	it('channel/getAll → conversations.list envelope', () => {
		const routes = slackMapper.fromNodeOutput(node('channel', 'getAll'), fx['channel/getAll']!);
		expect(serveThrough('slack', routes, { path: '/api/conversations.list' }).body).toEqual({
			ok: true,
			channels: fx['channel/getAll'],
			response_metadata: { next_cursor: '' },
		});
	});

	it('user/info', () =>
		expect(
			serveThrough(
				'slack',
				slackMapper.fromNodeOutput(node('user', 'info'), fx['user/info']!),
				{ path: '/api/users.info' },
			).body,
		).toEqual({ ok: true, user: fx['user/info']![0] }));

	it('unsupported → []', () =>
		expect(slackMapper.fromNodeOutput(node('file', 'upload'), [{}])).toEqual([]));
});
