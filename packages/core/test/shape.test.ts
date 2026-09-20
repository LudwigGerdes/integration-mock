import { describe, it, expect } from 'vitest';
import { diffShape } from '../src/shape.js';

describe('diffShape', () => {
	it('reports nothing when the shapes agree, however different the values', () => {
		// The whole point: a mock saying Evanston where production says
		// something else is not a defect.
		expect(
			diffShape(
				{ Id: '006mock', Name: 'Lakeshore', Amount: 48000 },
				{ Id: '006REAL0000001', Name: 'Something Else Entirely', Amount: 12 },
			),
		).toEqual([]);
	});

	it('flags a field the mock invented — the field reality does not have', () => {
		expect(diffShape({ Id: 'x', Guessed: 'oops' }, { Id: 'y' })).toEqual([
			{ kind: 'invented', path: 'Guessed', mock: 'string' },
		]);
	});

	it('flags a field the mock is missing', () => {
		expect(diffShape({ Id: 'x' }, { Id: 'y', Extra: 1 })).toEqual([
			{ kind: 'missing', path: 'Extra', real: 'number' },
		]);
	});

	it('flags a type disagreement', () => {
		expect(diffShape({ Amount: '48000' }, { Amount: 48000 })).toEqual([
			{ kind: 'type', path: 'Amount', mock: 'string', real: 'number' },
		]);
	});

	it('reports nested paths in dotted form', () => {
		expect(
			diffShape({ attributes: { type: 'Opportunity', bogus: 1 } }, { attributes: { type: 'Opportunity' } }),
		).toEqual([{ kind: 'invented', path: 'attributes.bogus', mock: 'number' }]);
	});

	it('compares arrays by element shape, not by length', () => {
		const mock = { records: [{ Id: 'a' }, { Id: 'b' }] };
		const real = { records: [{ Id: '1' }, { Id: '2' }, { Id: '3' }, { Id: '4' }] };
		expect(diffShape(mock, real)).toEqual([]);

		expect(diffShape({ records: [{ Id: 'a', Nope: true }] }, { records: [{ Id: '1' }] })).toEqual([
			{ kind: 'invented', path: 'records[].Nope', mock: 'boolean' },
		]);
	});

	it('treats null as its own type rather than an object', () => {
		expect(diffShape({ x: null }, { x: { a: 1 } })).toEqual([
			{ kind: 'type', path: 'x', mock: 'null', real: 'object' },
		]);
	});

	it('is deterministic in key order', () => {
		const a = diffShape({ b: 1, a: 'x', c: true }, {});
		expect(a.map((d) => d.path)).toEqual(['a', 'b', 'c']);
	});

	it('says nothing about an empty array on either side', () => {
		expect(diffShape({ records: [] }, { records: [{ Id: '1' }] })).toEqual([]);
	});
});
