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

describe('Stripe', () => {
	const form = { 'content-type': 'application/x-www-form-urlencoded' };

	it('validates without errors', async () => {
		const pack = await loadPack(join(libraryPacksDir(), 'stripe'));
		expect(validatePack(pack).filter((p) => p.level === 'error')).toEqual([]);
	});

	it('form-encoded create, idempotent retry, conflict, email filter, paging, delete', async () => {
		const { call } = await harness('stripe');
		const create = (body: string, key?: string) =>
			call({ method: 'POST', path: '/v1/customers', headers: { ...form, ...(key ? { 'idempotency-key': key } : {}) }, body });

		const first = create('email=ada%40example.com&name=Ada&metadata[plan]=pro', 'key-1');
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ id: 'cus_MOCK000001', object: 'customer', email: 'ada@example.com', metadata: { plan: 'pro' } });
		expect(create('email=ada%40example.com&name=Ada&metadata[plan]=pro', 'key-1').body).toEqual(first.body);
		expect(create('email=other%40example.com', 'key-1')).toMatchObject({ status: 409, body: { error: { type: 'idempotency_error' } } });

		create('email=grace%40example.com');
		create('email=alan%40example.com');
		const byEmail = call({ path: '/v1/customers', query: { email: 'grace@example.com' } }).body as { data: Array<{ email: string }> };
		expect(byEmail.data.map((c) => c.email)).toEqual(['grace@example.com']);

		const page1 = call({ path: '/v1/customers', query: { limit: '2' } }).body as { object: string; has_more: boolean; data: Array<{ id: string }> };
		expect(page1).toMatchObject({ object: 'list', has_more: true });
		const page2 = call({ path: '/v1/customers', query: { limit: '2', starting_after: page1.data[1]!.id } }).body as { has_more: boolean; data: unknown[] };
		expect(page2).toMatchObject({ has_more: false });
		expect(page2.data).toHaveLength(1);

		expect(call({ method: 'DELETE', path: '/v1/customers/cus_MOCK000001' }).body).toEqual({ id: 'cus_MOCK000001', object: 'customer', deleted: true });
		expect(call({ path: '/v1/customers/cus_MOCK000001' })).toMatchObject({ status: 404, body: { error: { code: 'resource_missing' } } });
	});

	it('the literal /v1/customers/search route still answers', async () => {
		const { call } = await harness('stripe');
		expect(call({ path: '/v1/customers/search', query: { query: "email:'x'" } }).matched).toMatchObject({ routeId: expect.stringMatching(/:literal$/) });
	});

	it('charges list by customer', async () => {
		const { call } = await harness('stripe');
		call({ method: 'POST', path: '/v1/charges', headers: form, body: 'amount=2000&currency=usd&customer=cus_A' });
		call({ method: 'POST', path: '/v1/charges', headers: form, body: 'amount=500&currency=usd&customer=cus_B' });
		const list = call({ path: '/v1/charges', query: { customer: 'cus_A' } }).body as { data: Array<{ id: string; amount: string }> };
		expect(list.data).toHaveLength(1);
		expect(list.data[0]).toMatchObject({ id: 'ch_MOCK000001', amount: 2000, object: 'charge', status: 'succeeded' });
	});
});

describe('review fixes: proof packs', () => {
	it('Stripe filters customers by created range, typed as numbers', async () => {
		const { call } = await harness('stripe');
		const form = { 'content-type': 'application/x-www-form-urlencoded' };
		call({ method: 'POST', path: '/v1/customers', headers: form, body: 'email=a%40x.io' });
		const res = call({ path: '/v1/customers', query: { 'created[gte]': '9999999999' } }).body as { data: unknown[] };
		expect(res.data).toEqual([]);
		const all = call({ path: '/v1/customers', query: { 'created[lte]': '9999999999' } }).body as { data: Array<{ created: unknown }> };
		expect(all.data).toHaveLength(1);
		expect(typeof all.data[0]!.created).toBe('number');
	});

	it('HubSpot search refuses free-text query and sorts rather than returning everything', async () => {
		const { call } = await harness('hubspot');
		expect(call({ method: 'POST', path: '/crm/v3/objects/contacts/search', body: { query: 'ada' } })).toMatchObject({
			status: 400,
			body: { error: 'body.query is not supported by integration-mock' },
		});
		expect(call({ method: 'POST', path: '/crm/v3/objects/contacts/search', body: { sorts: [{ propertyName: 'email' }] } }).status).toBe(400);
	});
});

describe('Salesforce Lead', () => {
	it('creates, reads, updates, queries and deletes Leads', async () => {
		const { call } = await harness('salesforce');
		const v = '/services/data/v59.0';
		const created = call({ method: 'POST', path: `${v}/sobjects/Lead`, body: { LastName: 'Lovelace', Company: 'Analytical Engines', Status: 'Open - Not Contacted' } });
		expect(created.status).toBe(201);
		const id = (created.body as { id: string }).id;
		expect(id).toMatch(/^00QMOCK\d{11}$/);
		expect(call({ path: `${v}/sobjects/Lead/${id}` }).body).toMatchObject({ Id: id, LastName: 'Lovelace', attributes: { type: 'Lead' } });
		expect(call({ method: 'PATCH', path: `${v}/sobjects/Lead/${id}`, body: { Status: 'Working - Contacted' } }).status).toBe(204);
		expect(call({ path: `${v}/query`, query: { q: "SELECT Id, Status FROM Lead WHERE Company = 'Analytical Engines'" } }).body).toMatchObject({
			totalSize: 1,
			records: [{ Id: id, Status: 'Working - Contacted' }],
		});
		expect(call({ method: 'DELETE', path: `${v}/sobjects/Lead/${id}` }).status).toBe(204);
		expect(call({ path: `${v}/sobjects/Lead/${id}` }).status).toBe(404);
	});
});
