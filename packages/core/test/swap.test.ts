import { describe, it, expect } from 'vitest';
import { swapWorkflowUrls } from '../src/swap.js';
import type { ServicePack } from '../src/types.js';

const packs: ServicePack[] = [
	{ id: 'slack', domains: ['slack.com', '*.slack.com'], prefix: '/slack', source: 'library', routes: [] },
	{ id: 'sf', domains: ['*.my.salesforce.com'], prefix: '/sf', source: 'authored', routes: [] },
];
const BASE = 'http://127.0.0.1:8080';

const wf = (url: string): unknown => ({
	nodes: [{ name: 'Call', type: 'n8n-nodes-base.httpRequest', parameters: { url, options: {} } }],
});
const urlOf = (w: unknown): unknown =>
	(w as { nodes: Array<{ parameters: { url: unknown } }> }).nodes[0]!.parameters.url;

describe('swapWorkflowUrls', () => {
	it('re-points a vendor URL at the mock, keeping path and query', () => {
		const r = swapWorkflowUrls(wf('https://slack.com/api/chat.postMessage?pretty=1'), packs, {
			direction: 'mock',
			baseUrl: BASE,
		});
		expect(urlOf(r.workflow)).toBe(`${BASE}/slack/api/chat.postMessage?pretty=1`);
		expect(r.changes).toHaveLength(1);
	});

	it('matches wildcard domains', () => {
		const r = swapWorkflowUrls(wf('https://acme.my.salesforce.com/services/data/v58.0/query'), packs, {
			direction: 'mock',
			baseUrl: BASE,
		});
		expect(urlOf(r.workflow)).toBe(`${BASE}/sf/services/data/v58.0/query`);
	});

	it('reverses without any stored state', () => {
		const there = swapWorkflowUrls(wf('https://slack.com/api/x'), packs, {
			direction: 'mock',
			baseUrl: BASE,
		});
		const back = swapWorkflowUrls(there.workflow, packs, { direction: 'real', baseUrl: BASE });
		expect(urlOf(back.workflow)).toBe('https://slack.com/api/x');
	});

	it('cannot reverse a pack that declares only wildcards, and says so', () => {
		const there = swapWorkflowUrls(wf('https://acme.my.salesforce.com/x'), packs, {
			direction: 'mock',
			baseUrl: BASE,
		});
		const back = swapWorkflowUrls(there.workflow, packs, { direction: 'real', baseUrl: BASE });
		expect(back.changes).toEqual([]);
		expect(back.skipped[0]?.reason).toMatch(/only wildcard domains/);
	});

	it('leaves an expression URL alone and reports it', () => {
		const r = swapWorkflowUrls(wf('={{ $json.endpoint }}'), packs, {
			direction: 'mock',
			baseUrl: BASE,
		});
		expect(urlOf(r.workflow)).toBe('={{ $json.endpoint }}');
		expect(r.skipped[0]?.reason).toMatch(/expression URL/);
	});

	it('ignores hosts no pack claims', () => {
		const r = swapWorkflowUrls(wf('https://unrelated.test/x'), packs, {
			direction: 'mock',
			baseUrl: BASE,
		});
		expect(urlOf(r.workflow)).toBe('https://unrelated.test/x');
		expect(r.changes).toEqual([]);
	});

	it('does not mutate the workflow it was given', () => {
		const original = wf('https://slack.com/api/x');
		swapWorkflowUrls(original, packs, { direction: 'mock', baseUrl: BASE });
		expect(urlOf(original)).toBe('https://slack.com/api/x');
	});

	it('handles a workflow with no nodes', () => {
		expect(swapWorkflowUrls({}, packs, { direction: 'mock', baseUrl: BASE }).changes).toEqual([]);
	});
});

describe('swapWorkflowUrls via proxy — the n8n Cloud path', () => {
	const httpNode = (url: string): unknown => ({
		nodes: [{ name: 'Call', type: 'n8n-nodes-base.httpRequest', parameters: { url, options: {} } }],
	});
	const optsOf = (w: unknown): Record<string, unknown> =>
		(w as { nodes: Array<{ parameters: { options: Record<string, unknown> } }> }).nodes[0]!
			.parameters.options;

	it('sets the node proxy and leaves the URL untouched', () => {
		const r = swapWorkflowUrls(httpNode('https://slack.com/api/x'), packs, {
			direction: 'mock',
			baseUrl: BASE,
			via: 'proxy',
		});
		expect(optsOf(r.workflow)).toEqual({ proxy: BASE, allowUnauthorizedCerts: true });
		expect(urlOf(r.workflow)).toBe('https://slack.com/api/x');
	});

	it('does not weaken TLS verification for a plain-HTTP call', () => {
		const r = swapWorkflowUrls(httpNode('http://slack.com/api/x'), packs, {
			direction: 'mock',
			baseUrl: BASE,
			via: 'proxy',
		});
		expect(optsOf(r.workflow)).toEqual({ proxy: BASE });
	});

	it('clears both settings on the way back — the cutover safety case', () => {
		const there = swapWorkflowUrls(httpNode('https://slack.com/api/x'), packs, {
			direction: 'mock',
			baseUrl: BASE,
			via: 'proxy',
		});
		const back = swapWorkflowUrls(there.workflow, packs, {
			direction: 'real',
			baseUrl: BASE,
			via: 'proxy',
		});
		expect(optsOf(back.workflow)).toEqual({});
		expect(back.changes).toHaveLength(1);
	});

	it('refuses a native node, which has no proxy option at all', () => {
		const slackNode = {
			nodes: [{ name: 'Slack', type: 'n8n-nodes-base.slack', parameters: { url: 'https://slack.com/api/x' } }],
		};
		const r = swapWorkflowUrls(slackNode, packs, { direction: 'mock', baseUrl: BASE, via: 'proxy' });
		expect(r.changes).toEqual([]);
		expect(r.skipped[0]?.reason).toMatch(/exposes no proxy option/);
	});

	it('leaves a proxy someone else set alone', () => {
		const w = {
			nodes: [{
				name: 'Call', type: 'n8n-nodes-base.httpRequest',
				parameters: { url: 'https://slack.com/api/x', options: { proxy: 'http://corp:3128' } },
			}],
		};
		const r = swapWorkflowUrls(w, packs, { direction: 'real', baseUrl: BASE, via: 'proxy' });
		expect(optsOf(r.workflow)).toEqual({ proxy: 'http://corp:3128' });
		expect(r.changes).toEqual([]);
	});
});
