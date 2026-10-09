import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
	ResourceStore,
	idSpecsFor,
	loadPack,
	resolve,
	validatePack,
	type MockRequest,
	type Resolution,
	type ServicePack,
} from 'integration-mock-core';
import { libraryPacksDir } from '../src/library.js';

const harness = async (service: string, tweak?: (pack: ServicePack) => void) => {
	const pack = await loadPack(join(libraryPacksDir(), service));
	tweak?.(pack);
	const store = new ResourceStore(pack.seed, idSpecsFor([pack]));
	const counters = new Map<string, number>();
	const call = (o: Partial<MockRequest>): Resolution =>
		resolve(
			{ library: [pack], user: [], project: [], snapshot: [] },
			service,
			{ method: 'GET', host: '', path: '/', query: {}, headers: { 'content-type': 'application/json' }, ...o },
			store,
			counters,
		);
	return { pack, call };
};

describe('Salesforce', () => {
	const v = '/services/data/v59.0';

	it('validates without errors', async () => {
		const pack = await loadPack(join(libraryPacksDir(), 'salesforce'));
		expect(validatePack(pack).filter((p) => p.level === 'error')).toEqual([]);
	});

	it('create → get → update → SOQL → nextRecordsUrl → delete → 404', async () => {
		const { pack, call } = await harness('salesforce', (p) => {
			const query = p.routes.find((r) => r.id === 'salesforce:query')!;
			query.store!.pagination!.defaultLimit = 2;
		});
		const seeded = pack.seed?.['Opportunity']?.length ?? 0;

		const created = call({ method: 'POST', path: `${v}/sobjects/Opportunity`, body: { Name: 'Ravinia sponsorship', StageName: 'Prospecting', Amount: 5000 } });
		expect(created.status).toBe(201);
		const id = (created.body as { id: string }).id;
		expect(id).toMatch(/^006MOCK\d{11}$/);
		expect(created.body).toEqual({ id, success: true, errors: [] });

		expect(call({ path: `${v}/sobjects/Opportunity/${id}` }).body).toMatchObject({
			Id: id,
			Name: 'Ravinia sponsorship',
			attributes: { type: 'Opportunity', url: `${v}/sobjects/Opportunity/${id}` },
		});

		expect(call({ method: 'PATCH', path: `${v}/sobjects/Opportunity/${id}`, body: { StageName: 'Closed Won' } }).status).toBe(204);

		const won = call({ path: `${v}/query`, query: { q: "SELECT Id, StageName FROM Opportunity WHERE StageName = 'Closed Won'" } });
		expect(won.body).toMatchObject({ totalSize: 1, done: true, records: [{ Id: id, StageName: 'Closed Won' }] });
		expect((won.body as { records: Array<Record<string, unknown>> }).records[0]).not.toHaveProperty('Name');

		call({ method: 'POST', path: `${v}/sobjects/Opportunity`, body: { Name: 'Second' } });
		const first = call({ path: `${v}/query`, query: { q: 'select id from opportunity' } }).body as {
			totalSize: number;
			done: boolean;
			records: unknown[];
			nextRecordsUrl: string;
		};
		expect(first).toMatchObject({ totalSize: seeded + 2, done: false });
		expect(first.records).toHaveLength(2);
		expect(first.nextRecordsUrl).toMatch(new RegExp(`^${v}/query/mock\\d{6}-2$`));
		const rest = call({ path: first.nextRecordsUrl }).body as { records: unknown[]; done: boolean };
		expect(rest.records.length).toBeGreaterThan(0);

		expect(call({ path: `${v}/query`, query: { q: 'SELECT Id FROM Opportunity WHERE A = 1 OR B = 2' } })).toMatchObject({
			status: 400,
			body: [{ errorCode: 'MALFORMED_QUERY', message: 'OR in SOQL is not supported by integration-mock' }],
		});
		expect(call({ path: `${v}/query`, query: { q: 'INVALID' } }).status).toBe(400);

		expect(call({ method: 'DELETE', path: `${v}/sobjects/Opportunity/${id}` }).status).toBe(204);
		expect(call({ path: `${v}/sobjects/Opportunity/${id}` })).toMatchObject({ status: 404, body: [{ errorCode: 'NOT_FOUND' }] });
	});

	it('Accounts and Contacts are stateful too, and the seeded records are readable', async () => {
		const { pack, call } = await harness('salesforce');
		const seededAccount = pack.seed?.['Account']?.[0] as { Id: string };
		expect(call({ path: `${v}/sobjects/Account/${seededAccount.Id}` }).status).toBe(200);
		const contact = call({ method: 'POST', path: `${v}/sobjects/Contact`, body: { LastName: 'Hopper' } });
		expect((contact.body as { id: string }).id).toMatch(/^003MOCK/);
	});
});

describe('HubSpot', () => {
	const base = '/crm/v3/objects';

	it('validates without errors', async () => {
		const pack = await loadPack(join(libraryPacksDir(), 'hubspot'));
		expect(validatePack(pack).filter((p) => p.level === 'error')).toEqual([]);
	});

	it('walks three pages of contacts with after, searches, deep-merges a PATCH, deletes', async () => {
		const { call } = await harness('hubspot');
		const ids: string[] = [];
		for (let i = 1; i <= 25; i++) {
			const res = call({
				method: 'POST',
				path: `${base}/contacts`,
				body: { properties: { email: `p${i}@example.com`, firstname: `P${i}`, lifecyclestage: i % 5 === 0 ? 'customer' : 'lead' } },
			});
			expect(res.status).toBe(201);
			ids.push((res.body as { id: string }).id);
		}
		const pages: string[][] = [];
		let after: string | undefined;
		do {
			const res = call({ path: `${base}/contacts`, query: { limit: '10', ...(after ? { after } : {}) } }).body as {
				results: Array<{ id: string }>;
				paging: { next: { after: string } };
			};
			pages.push(res.results.map((r) => r.id));
			after = res.paging.next.after || undefined;
		} while (after !== undefined);
		expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
		expect(pages.flat()).toEqual(ids);

		const search = call({
			method: 'POST',
			path: `${base}/contacts/search`,
			body: { filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }], limit: 3 },
		}).body as { total: number; results: unknown[] };
		expect(search.total).toBe(5);
		expect(search.results).toHaveLength(3);

		const id = ids[0]!;
		const patched = call({ method: 'PATCH', path: `${base}/contacts/${id}`, body: { properties: { firstname: 'Ada' } } }).body as {
			properties: Record<string, string>;
		};
		expect(patched.properties).toMatchObject({ email: 'p1@example.com', firstname: 'Ada' });

		expect(call({ method: 'DELETE', path: `${base}/contacts/${id}` }).status).toBe(204);
		expect(call({ path: `${base}/contacts/${id}` })).toMatchObject({ status: 404, body: { category: 'OBJECT_NOT_FOUND' } });
	});

	it('companies and deals are separate collections', async () => {
		const { call } = await harness('hubspot');
		call({ method: 'POST', path: `${base}/companies`, body: { properties: { name: 'Acme' } } });
		expect((call({ path: `${base}/deals` }).body as { results: unknown[] }).results).toEqual([]);
	});
});
