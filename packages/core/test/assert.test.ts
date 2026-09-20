import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateAssertion, selectPath, type AssertionRow } from '../src/assert.js';

const table = JSON.parse(
	readFileSync(new URL('../../../conformance/matchers.json', import.meta.url), 'utf8'),
) as { rows: Array<AssertionRow & { name: string; result: boolean }> };

describe('S3 conformance — assertion matchers', () => {
	it('the published table is non-trivial', () => expect(table.rows.length).toBeGreaterThan(20));

	for (const row of table.rows) {
		it(row.name, () => {
			expect(evaluateAssertion(row)).toBe(row.result);
		});
	}
});

describe('selectPath', () => {
	it('returns every match for a glob and none for a miss', () => {
		expect(selectPath({ a: [{ b: 1 }, { b: 2 }] }, 'a[*].b')).toEqual([1, 2]);
		expect(selectPath({ a: 1 }, 'z')).toEqual([]);
	});
});
