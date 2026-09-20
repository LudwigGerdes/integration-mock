import type { ReverseMapper, Route } from 'integration-mock-core';

/** Accepts a resource-locator or a bare string; `undefined` for expressions. */
const rl = (v: unknown): string | undefined => {
	const o = v as { value?: unknown } | undefined;
	const s = o?.value ?? v;
	return typeof s === 'string' && !s.startsWith('=') ? s : undefined;
};

/** Row objects back into the header row + value rows the Sheets API returns. */
const matrix = (rows: unknown[]): string[][] => {
	const items = rows.map((r) => (r !== null && typeof r === 'object' ? (r as Record<string, unknown>) : {}));
	const headers = Object.keys(items[0] ?? {});
	return [
		headers,
		...items.map((it) => headers.map((h) => (it[h] === undefined || it[h] === null ? '' : String(it[h])))),
	];
};

export const googleSheetsMapper: ReverseMapper = {
	nodeType: 'n8n-nodes-base.googleSheets',
	service: 'google-sheets',
	domains: ['sheets.googleapis.com'],
	fromNodeOutput(node, outputs) {
		const S = rl(node.parameters.documentId);
		const T = rl(node.parameters.sheetName);
		if (S === undefined || T === undefined) return [];

		const op = String(node.parameters.operation ?? 'read');
		const enc = encodeURIComponent(T);

		if (op === 'read') {
			const values = matrix(outputs);
			const path = `/v4/spreadsheets/${S}/values/${enc}`;
			return [
				{
					id: `google-sheets:GET:${path}#0`,
					match: { method: 'GET', path },
					respond: { status: 200, body: { range: T, majorDimension: 'ROWS', values } },
				},
			];
		}

		if (op === 'append') {
			const cols = matrix(outputs)[0]!.length;
			const path = `/v4/spreadsheets/${S}/values/${enc}:append`;
			return [
				{
					id: `google-sheets:POST:${path}#0`,
					match: { method: 'POST', path },
					respond: {
						status: 200,
						body: {
							spreadsheetId: S,
							updates: {
								spreadsheetId: S,
								updatedRange: T,
								updatedRows: outputs.length,
								updatedColumns: cols,
								updatedCells: outputs.length * cols,
							},
						},
					},
				},
			];
		}

		if (op === 'appendOrUpdate' || op === 'update') {
			const path = `/v4/spreadsheets/${S}/values:batchUpdate`;
			return [
				{
					id: `google-sheets:POST:${path}#0`,
					match: { method: 'POST', path },
					respond: {
						status: 200,
						body: { spreadsheetId: S, totalUpdatedRows: outputs.length, responses: [] },
					},
				},
			] satisfies Route[];
		}

		return [];
	},
};
