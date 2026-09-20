import { describe, it, expect } from 'vitest';
import { resolve, serviceForHost, serviceForPrefix, type LayeredPacks } from '../src/layers.js';
import { ResourceStore } from '../src/store.js';
import type { MockRequest, ServicePack } from '../src/types.js';

const req = (o: Partial<MockRequest>): MockRequest => ({
	method: 'GET',
	host: 'slack.com',
	path: '/',
	query: {},
	headers: {},
	...o,
});

const pack = (
	id: string,
	source: ServicePack['source'],
	routes: ServicePack['routes'] = [],
): ServicePack => ({
	id,
	domains: [`${id}.com`, `*.${id}.com`],
	prefix: `/${id}`,
	routes,
	source,
});

const empty = (): LayeredPacks => ({ library: [], user: [], project: [], snapshot: [] });

describe('serviceForHost', () => {
	const p = { ...empty(), library: [pack('slack', 'library')] };
	it('exact and wildcard', () => {
		expect(serviceForHost(p, 'slack.com')).toBe('slack');
		expect(serviceForHost(p, 'api.slack.com')).toBe('slack');
		expect(serviceForHost(p, 'notslack.com')).toBeNull();
	});
	it('searches all layers', () =>
		expect(serviceForHost({ ...empty(), project: [pack('hub', 'recorded')] }, 'hub.com')).toBe('hub'));
});

describe('serviceForPrefix', () => {
	it('strips prefix', () =>
		expect(serviceForPrefix({ ...empty(), library: [pack('slack', 'library')] }, '/slack/api/x')).toEqual({
			service: 'slack',
			rest: '/api/x',
		}));
	it('null when unknown', () => expect(serviceForPrefix(empty(), '/zzz/a')).toBeNull());
});

describe('resolve precedence', () => {
	const r = (id: string, body: unknown) => ({
		id,
		match: { method: 'GET' as const, path: '/api/x' },
		respond: { status: 200, body },
	});

	it('snapshot beats project beats user beats library', () => {
		const p: LayeredPacks = {
			library: [pack('slack', 'library', [r('lib', 'L')])],
			user: [pack('slack', 'recorded', [r('usr', 'U')])],
			project: [pack('slack', 'recorded', [r('prj', 'P')])],
			snapshot: [pack('slack', 'snapshot:1', [r('snap', 'S')])],
		};
		const st = new ResourceStore();
		const rq = req({ path: '/api/x' });
		expect(resolve(p, 'slack', rq, st).body).toBe('S');
		p.snapshot = [];
		expect(resolve(p, 'slack', rq, st).body).toBe('P');
		p.project = [];
		expect(resolve(p, 'slack', rq, st).body).toBe('U');
		p.user = [];
		const res = resolve(p, 'slack', rq, st);
		expect(res.body).toBe('L');
		expect(res.matched).toEqual({ routeId: 'lib', layer: 'library' });
	});

	it('falls to store, then unmatched with exact 501 body', () => {
		const p = { ...empty(), library: [pack('crm', 'library')] };
		const st = new ResourceStore({ contacts: [{ id: '1' }] });
		expect(resolve(p, 'crm', req({ host: 'crm.com', path: '/contacts' }), st).body).toEqual({
			data: [{ id: '1' }],
		});
		const un = resolve(p, 'crm', req({ host: 'crm.com', method: 'POST', path: '/api/weird.call' }), st);
		expect(un.status).toBe(501);
		expect(un.matched).toBe('unmatched');
		expect(un.body).toEqual({
			error: 'integration-mock: no route',
			service: 'crm',
			method: 'POST',
			path: '/api/weird.call',
			hint: 'run `integration-mock record` or add to ./.integration-mock/packs/crm',
		});
	});

	it('handler-only routes are skipped in phase 0', () => {
		// Path deliberately not a REST shape (contains a dot), so skipping the
		// handler route falls through the store all the way to `unmatched`.
		const path = '/api/chat.postMessage';
		const p = {
			...empty(),
			library: [
				pack('s', 'library', [{ id: 'h', match: { method: 'GET' as const, path }, handler: 'f.js#fn' }]),
			],
		};
		expect(resolve(p, 's', req({ path }), new ResourceStore()).matched).toBe('unmatched');
	});
});
