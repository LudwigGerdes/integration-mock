import { describe, it, expect } from 'vitest';
import { renderTemplate, type TemplateContext } from '../src/template.js';
import type { MockRequest } from '../src/types.js';

const request: MockRequest = {
	method: 'POST',
	host: 'api.acme.test',
	path: '/v1/orders/o_9',
	query: { page: '2' },
	headers: { 'x-request-id': 'req-1' },
	body: { customer: { id: 'c_1', tags: ['a', 'b'] }, total: 12.5 },
};
const ctx: TemplateContext = {
	request,
	params: { id: 'o_9' },
	count: 3,
	now: () => new Date('2026-09-25T10:00:00.000Z'),
	uuid: () => '00000000-0000-4000-8000-000000000000',
};

describe('renderTemplate', () => {
	it('echoes request fields, params, query and headers into strings', () => {
		expect(
			renderTemplate(
				{ id: '{{request.params.id}}', who: 'customer {{request.body.customer.id}} p{{request.query.page}}', rid: '{{request.headers.X-Request-Id}}' },
				ctx,
			),
		).toEqual({ id: 'o_9', who: 'customer c_1 p2', rid: 'req-1' });
	});

	it('a whole-string placeholder yields the value itself, object or number', () => {
		expect(renderTemplate({ echo: '{{request.body}}', total: '{{request.body.total}}', n: '{{counter}}' }, ctx)).toEqual({
			echo: request.body,
			total: 12.5,
			n: 3,
		});
	});

	it('uuid, now and timestamp come from the context, so a test can pin them', () => {
		expect(renderTemplate('{{uuid}}|{{now}}|{{timestamp}}', ctx)).toBe(
			'00000000-0000-4000-8000-000000000000|2026-09-25T10:00:00.000Z|1790330400',
		);
	});

	it('leaves an unknown placeholder, a non-string leaf and nested arrays alone', () => {
		expect(renderTemplate({ keep: '{{nope}} and {{request.secret}}', n: 1, list: [true, '{{counter}}'] }, ctx)).toEqual({
			keep: '{{nope}} and {{request.secret}}',
			n: 1,
			list: [true, 3],
		});
	});
});
