import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { N8nNode } from 'integration-mock-core';
import { airtableMapper } from '../../src/mappers/airtable.js';
import { serveThrough } from '../helpers/serve.js';

const fx = JSON.parse(
	readFileSync(new URL('../fixtures/airtable.node-output.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;

const node = (operation: string, extra: Record<string, unknown> = {}): N8nNode => ({
	name: 'Airtable',
	type: 'n8n-nodes-base.airtable',
	typeVersion: 2.1,
	parameters: {
		operation,
		base: { __rl: true, value: 'app1', mode: 'id' },
		table: { __rl: true, value: 'Contacts', mode: 'name' },
		...extra,
	},
});

describe('airtable mapper', () => {
	it('search → records envelope', () => {
		const routes = airtableMapper.fromNodeOutput(node('search'), fx.search!);
		const res = serveThrough('airtable', routes, { path: '/v0/app1/Contacts' });
		expect((res.body as { records: Array<{ fields: { Name: string } }> }).records[0]!.fields.Name).toBe('A');
	});

	it('create → POST to the table', () => {
		const routes = airtableMapper.fromNodeOutput(node('create'), fx.create!);
		const res = serveThrough('airtable', routes, { method: 'POST', path: '/v0/app1/Contacts' });
		expect((res.body as { records: Array<{ id: string }> }).records[0]!.id).toBe('rec2');
	});

	it('get → one route per record id', () => {
		const routes = airtableMapper.fromNodeOutput(node('get'), fx.search!);
		const res = serveThrough('airtable', routes, { path: '/v0/app1/Contacts/rec1' });
		expect((res.body as { id: string }).id).toBe('rec1');
	});

	it('normalises simplified items lacking a fields wrapper', () => {
		const routes = airtableMapper.fromNodeOutput(node('search'), fx.simplified!);
		const res = serveThrough('airtable', routes, { path: '/v0/app1/Contacts' });
		expect((res.body as { records: Array<{ fields: { Name: string } }> }).records[0]!.fields.Name).toBe('C');
	});

	it('deleteRecord → deleted flags', () => {
		const routes = airtableMapper.fromNodeOutput(node('deleteRecord'), fx.search!);
		const res = serveThrough('airtable', routes, { method: 'DELETE', path: '/v0/app1/Contacts' });
		expect((res.body as { records: Array<{ deleted: boolean }> }).records[0]!.deleted).toBe(true);
	});

	it('expression base → []', () =>
		expect(
			airtableMapper.fromNodeOutput(node('search', { base: { __rl: true, value: '={{ $json.b }}' } }), fx.search!),
		).toEqual([]));
});
