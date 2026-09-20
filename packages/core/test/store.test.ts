import { describe, it, expect } from 'vitest';
import { ResourceStore } from '../src/store.js';
import type { MockRequest } from '../src/types.js';

const req = (o: Partial<MockRequest>): MockRequest => ({
	method: 'GET',
	host: 'h',
	path: '/',
	query: {},
	headers: {},
	...o,
});

describe('ResourceStore CRUD', () => {
	it('seeds and lists', () => {
		const s = new ResourceStore({ contacts: [{ id: 'c1', name: 'A' }] });
		expect(s.list('contacts')).toEqual([{ id: 'c1', name: 'A' }]);
		expect(s.list('nope')).toEqual([]);
	});
	it('create assigns id, get/update/delete work', () => {
		const s = new ResourceStore();
		const made = s.create('x', { name: 'n' }) as { id: string; name: string };
		expect(typeof made.id).toBe('string');
		expect(s.get('x', made.id)).toEqual(made);
		expect(s.update('x', made.id, { name: 'm' })).toEqual({ id: made.id, name: 'm' });
		expect(s.delete('x', made.id)).toBe(true);
		expect(s.get('x', made.id)).toBeUndefined();
		expect(s.delete('x', 'ghost')).toBe(false);
	});
	it('reset restores seed', () => {
		const s = new ResourceStore({ a: [{ id: '1' }] });
		s.create('a', { id: '2' });
		s.reset();
		expect(s.list('a')).toEqual([{ id: '1' }]);
	});
});

describe('ResourceStore.handle', () => {
	const s = () => new ResourceStore({ contacts: [{ id: 'c1', name: 'A' }] });
	it('GET list (with version prefix)', () => {
		const r = s().handle(req({ path: '/v3/contacts' }))!;
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ data: [{ id: 'c1', name: 'A' }] });
		expect(r.matched).toEqual({ routeId: 'store:list:contacts', layer: 'store' });
	});
	it('GET one / 404', () => {
		expect(s().handle(req({ path: '/contacts/c1' }))!.body).toEqual({ id: 'c1', name: 'A' });
		expect(s().handle(req({ path: '/contacts/zz' }))!.status).toBe(404);
	});
	it('POST creates 201', () => {
		const st = s();
		const r = st.handle(req({ method: 'POST', path: '/contacts', body: { name: 'B' } }))!;
		expect(r.status).toBe(201);
		expect(st.list('contacts')).toHaveLength(2);
	});
	it('PATCH and DELETE', () => {
		const st = s();
		expect(st.handle(req({ method: 'PATCH', path: '/contacts/c1', body: { name: 'Z' } }))!.body).toEqual({
			id: 'c1',
			name: 'Z',
		});
		expect(st.handle(req({ method: 'DELETE', path: '/contacts/c1' }))!.status).toBe(204);
		expect(st.get('contacts', 'c1')).toBeUndefined();
	});
	it('unknown collection falls through so the caller can 501', () => {
		expect(s().handle(req({ path: '/users' }))).toBeNull();
		expect(s().handle(req({ method: 'POST', path: '/users', body: {} }))).toBeNull();
		// A known collection still 404s a missing member rather than falling through.
		expect(s().handle(req({ path: '/contacts/zz' }))!.status).toBe(404);
	});

	it('non-REST shape returns null', () => {
		expect(s().handle(req({ path: '/api/chat.postMessage', method: 'POST' }))).toBeNull();
		expect(s().handle(req({ path: '/a/b/c/d' }))).toBeNull();
	});
});
