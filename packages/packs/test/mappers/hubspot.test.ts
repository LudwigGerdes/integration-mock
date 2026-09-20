import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { N8nNode } from 'integration-mock-core';
import { hubspotMapper } from '../../src/mappers/hubspot.js';
import { serveThrough } from '../helpers/serve.js';

const fx = JSON.parse(
	readFileSync(new URL('../fixtures/hubspot.node-output.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;

const node = (resource: string, operation: string): N8nNode => ({
	name: 'HubSpot',
	type: 'n8n-nodes-base.hubspot',
	typeVersion: 2.1,
	parameters: { resource, operation },
});

describe('hubspot mapper', () => {
	it('contact/getAll → results envelope', () => {
		const routes = hubspotMapper.fromNodeOutput(node('contact', 'getAll'), fx['contact/getAll']!);
		const res = serveThrough('hubspot', routes, { path: '/crm/v3/objects/contacts' });
		expect(
			(res.body as { results: Array<{ properties: { email: string } }> }).results[0]!.properties
				.email,
		).toBe('a@x.com');
	});

	it('contact/create → 201 at the collection', () => {
		const routes = hubspotMapper.fromNodeOutput(node('contact', 'create'), fx['contact/create']!);
		const res = serveThrough('hubspot', routes, { method: 'POST', path: '/crm/v3/objects/contacts' });
		expect(res.status).toBe(201);
		expect((res.body as { id: string }).id).toBe('102');
	});

	it('contact/get → per-id route', () => {
		const routes = hubspotMapper.fromNodeOutput(node('contact', 'get'), fx['contact/getAll']!);
		expect(
			(serveThrough('hubspot', routes, { path: '/crm/v3/objects/contacts/101' }).body as {
				id: string;
			}).id,
		).toBe('101');
	});

	it('contact/search → total + results', () => {
		const routes = hubspotMapper.fromNodeOutput(node('contact', 'search'), fx['contact/getAll']!);
		const res = serveThrough('hubspot', routes, {
			method: 'POST',
			path: '/crm/v3/objects/contacts/search',
		});
		expect(res.body).toMatchObject({ total: 1 });
	});

	it('deal maps to the deals path', () => {
		const routes = hubspotMapper.fromNodeOutput(node('deal', 'getAll'), fx['contact/getAll']!);
		expect(routes[0]!.match.path).toBe('/crm/v3/objects/deals');
	});

	it('unsupported resource → []', () =>
		expect(hubspotMapper.fromNodeOutput(node('ticket', 'getAll'), [{}])).toEqual([]));
});
