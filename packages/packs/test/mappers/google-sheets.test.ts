import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { N8nNode } from 'integration-mock-core';
import { googleSheetsMapper } from '../../src/mappers/google-sheets.js';
import { serveThrough } from '../helpers/serve.js';

const fx = JSON.parse(
	readFileSync(new URL('../fixtures/google-sheets.node-output.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;

const node = (operation: string, extra: Record<string, unknown> = {}): N8nNode => ({
	name: 'Sheets',
	type: 'n8n-nodes-base.googleSheets',
	typeVersion: 4.5,
	parameters: {
		operation,
		documentId: { __rl: true, value: 'S1', mode: 'id' },
		sheetName: { __rl: true, value: 'Sheet1', mode: 'name' },
		...extra,
	},
});

describe('google sheets mapper', () => {
	it('read → values matrix served at the sheets range endpoint', () => {
		const routes = googleSheetsMapper.fromNodeOutput(node('read'), fx.read!);
		const res = serveThrough('google-sheets', routes, {
			path: '/v4/spreadsheets/S1/values/Sheet1',
		});
		expect(res.body).toEqual({
			range: 'Sheet1',
			majorDimension: 'ROWS',
			values: [
				['Name', 'Email'],
				['A', 'a@x.com'],
				['B', 'b@x.com'],
			],
		});
	});

	it('append → :append endpoint reporting the rows added', () => {
		const routes = googleSheetsMapper.fromNodeOutput(node('append'), fx.append!);
		const res = serveThrough('google-sheets', routes, {
			method: 'POST',
			path: '/v4/spreadsheets/S1/values/Sheet1:append',
		});
		expect(res.body).toMatchObject({
			spreadsheetId: 'S1',
			updates: { updatedRows: 1, updatedColumns: 2, updatedCells: 2 },
		});
	});

	it('appendOrUpdate → batchUpdate endpoint', () => {
		const routes = googleSheetsMapper.fromNodeOutput(node('appendOrUpdate'), fx.append!);
		const res = serveThrough('google-sheets', routes, {
			method: 'POST',
			path: '/v4/spreadsheets/S1/values:batchUpdate',
		});
		expect(res.body).toMatchObject({ spreadsheetId: 'S1', totalUpdatedRows: 1 });
	});

	it('expression documentId → []', () =>
		expect(
			googleSheetsMapper.fromNodeOutput(
				node('read', { documentId: { __rl: true, value: '={{ $json.id }}' } }),
				fx.read!,
			),
		).toEqual([]));
});
