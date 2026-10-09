import { describe, it, expect } from 'vitest';
import { applySoql, parseSoql, selectFields } from '../src/soql.js';

const ok = (text: string) => {
	const r = parseSoql(text);
	if (!r.ok) throw new Error(r.error);
	return r.query;
};

describe('parseSoql', () => {
	it('reads fields, object, AND conditions, ORDER BY and LIMIT', () => {
		expect(ok("SELECT Id, Name FROM Opportunity WHERE StageName = 'Closed Won' AND Amount >= 5000 ORDER BY Amount DESC LIMIT 10")).toEqual({
			fields: ['Id', 'Name'],
			from: 'Opportunity',
			where: [
				{ field: 'StageName', op: 'eq', value: 'Closed Won' },
				{ field: 'Amount', op: 'gte', value: 5000 },
			],
			orderBy: { field: 'Amount', direction: 'desc' },
			limit: 10,
		});
	});

	it('is case-insensitive for keywords', () => {
		expect(ok("select id from opportunity where name != 'x'")).toMatchObject({ from: 'opportunity', where: [{ field: 'name', op: 'ne', value: 'x' }] });
	});

	it('reads escaped quotes, booleans, null, bare dates and <>', () => {
		expect(ok("SELECT Id FROM Account WHERE Name = 'O\\'Hare' AND IsActive = true AND Parent = null AND CreatedDate > 2026-01-01T00:00:00Z AND Rating <> 'Cold'").where).toEqual([
			{ field: 'Name', op: 'eq', value: "O'Hare" },
			{ field: 'IsActive', op: 'eq', value: true },
			{ field: 'Parent', op: 'eq', value: null },
			{ field: 'CreatedDate', op: 'gt', value: '2026-01-01T00:00:00Z' },
			{ field: 'Rating', op: 'ne', value: 'Cold' },
		]);
	});

	it("maps LIKE '%x%' to contains and LIKE 'x' to eq", () => {
		expect(ok("SELECT Id FROM Contact WHERE Email LIKE '%example%'").where).toEqual([{ field: 'Email', op: 'contains', value: 'example' }]);
		expect(ok("SELECT Id FROM Contact WHERE Email LIKE 'a@b.c'").where).toEqual([{ field: 'Email', op: 'eq', value: 'a@b.c' }]);
	});

	it.each([
		["SELECT Id FROM Opportunity WHERE A = 1 OR B = 2", 'OR in SOQL'],
		["SELECT Id FROM Opportunity WHERE (A = 1)", 'Parentheses in SOQL'],
		["SELECT COUNT(Id) FROM Opportunity", 'Functions in SOQL'],
		["SELECT Account.Name FROM Opportunity", 'Relationship fields (Account.Name) in SOQL'],
		["SELECT Id FROM Opportunity WHERE Id IN ('a')", 'IN in SOQL'],
		["SELECT Id FROM Opportunity WHERE Name LIKE 'Acme%'", "LIKE 'Acme%' in SOQL"],
		["SELECT Id FROM Opportunity OFFSET 5", 'OFFSET in SOQL'],
		["SELECT Id FROM Opportunity GROUP BY Name", 'GROUP in SOQL'],
	])('rejects %s, naming the construct', (text, construct) => {
		const r = parseSoql(text);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error).toContain(construct);
	});

	it('rejects garbage with a reason', () => {
		expect(parseSoql('DELETE FROM Account')).toEqual({ ok: false, error: 'SOQL must start with SELECT' });
		expect(parseSoql("SELECT Id FROM Account WHERE Name = 'open")).toEqual({ ok: false, error: 'SOQL could not be read: an unterminated string' });
	});
});

describe('applySoql and selectFields', () => {
	const rows = [
		{ Id: '1', Name: 'Ravinia', StageName: 'Closed Won', Amount: 500 },
		{ Id: '2', Name: 'Lakeshore', StageName: 'Prospecting', Amount: 9000 },
		{ Id: '3', Name: 'Evanston', StageName: 'Closed Won', Amount: 7000 },
	];

	it('filters with field names in any case, orders and limits', () => {
		const q = ok("select id, name from Opportunity where stagename = 'Closed Won' order by amount desc limit 1");
		expect(applySoql(rows, q).map((r) => r.Id)).toEqual(['3']);
	});

	it('keeps the id and attributes when trimming to the selected fields', () => {
		const withAttrs = [{ attributes: { type: 'Opportunity' }, Id: '1', Name: 'A', Amount: 1 }];
		expect(selectFields(withAttrs, ['Name'], 'Id')).toEqual([{ attributes: { type: 'Opportunity' }, Id: '1', Name: 'A' }]);
		expect(selectFields(withAttrs, '*', 'Id')).toEqual(withAttrs);
	});
});
