import type { ReverseMapper, Route } from 'integration-mock-core';

const rl = (v: unknown): string | undefined => {
	const o = v as { value?: unknown } | undefined;
	const s = o?.value ?? v;
	return typeof s === 'string' && !s.startsWith('=') ? s : undefined;
};

interface Record_ {
	id: string;
	createdTime: string;
	fields: unknown;
}

/**
 * The node emits `{id, createdTime, fields}` normally, but flattens to the
 * fields themselves when "simplify" is on — restore the API's own shape.
 */
const normalize = (o: unknown, i: number): Record_ => {
	const r = (o !== null && typeof o === 'object' ? o : {}) as {
		id?: unknown;
		createdTime?: unknown;
		fields?: unknown;
	};
	if (r.fields !== undefined) {
		return {
			id: typeof r.id === 'string' ? r.id : `rec${i}`,
			createdTime: typeof r.createdTime === 'string' ? r.createdTime : new Date(0).toISOString(),
			fields: r.fields,
		};
	}
	return {
		id: typeof r.id === 'string' ? r.id : `rec${i}`,
		createdTime: new Date(0).toISOString(),
		fields: o,
	};
};

export const airtableMapper: ReverseMapper = {
	nodeType: 'n8n-nodes-base.airtable',
	service: 'airtable',
	domains: ['api.airtable.com'],
	fromNodeOutput(node, outputs) {
		const B = rl(node.parameters.base);
		const T = rl(node.parameters.table);
		if (B === undefined || T === undefined) return [];

		const op = String(node.parameters.operation ?? 'search');
		const path = `/v0/${B}/${encodeURIComponent(T)}`;
		const records = outputs.map(normalize);

		const envelope = (method: 'GET' | 'POST' | 'PATCH', body: unknown): Route[] => [
			{ id: `airtable:${method}:${path}#0`, match: { method, path }, respond: { status: 200, body } },
		];

		if (op === 'search' || op === 'list') return envelope('GET', { records });
		if (op === 'create') return envelope('POST', { records });
		if (op === 'update' || op === 'upsert') return envelope('PATCH', { records });

		if (op === 'get') {
			return records.map(
				(r, i): Route => ({
					id: `airtable:GET:${path}/${r.id}#${i}`,
					match: { method: 'GET', path: `${path}/${r.id}` },
					respond: { status: 200, body: r },
				}),
			);
		}

		if (op === 'deleteRecord') {
			return [
				{
					id: `airtable:DELETE:${path}#0`,
					match: { method: 'DELETE', path },
					respond: {
						status: 200,
						body: { records: records.map((r) => ({ id: r.id, deleted: true })) },
					},
				},
			];
		}

		return [];
	},
};
