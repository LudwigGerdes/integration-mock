import type { ReverseMapper, Route } from 'integration-mock-core';

/** n8n resource name → HubSpot v3 object path segment. */
const RESOURCES: Record<string, string> = {
	contact: 'contacts',
	company: 'companies',
	deal: 'deals',
};

interface CrmObject {
	id: string;
	properties: unknown;
	createdAt: string;
	updatedAt: string;
	archived: boolean;
}

/** Items arrive v3-shaped, or flattened to properties when simplified. */
const normalize = (o: unknown, i: number): CrmObject => {
	const r = (o !== null && typeof o === 'object' ? o : {}) as Partial<CrmObject> & {
		properties?: unknown;
	};
	const now = new Date(0).toISOString();
	if (r.properties !== undefined) {
		return {
			id: typeof r.id === 'string' ? r.id : String(i),
			properties: r.properties,
			createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
			updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
			archived: r.archived === true,
		};
	}
	return {
		id: typeof r.id === 'string' ? r.id : String(i),
		properties: o,
		createdAt: now,
		updatedAt: now,
		archived: false,
	};
};

export const hubspotMapper: ReverseMapper = {
	nodeType: 'n8n-nodes-base.hubspot',
	service: 'hubspot',
	domains: ['api.hubapi.com'],
	fromNodeOutput(node, outputs) {
		const { resource, operation } = node.parameters as { resource?: string; operation?: string };
		const seg = RESOURCES[String(resource)];
		if (seg === undefined) return [];

		const path = `/crm/v3/objects/${seg}`;
		const results = outputs.map(normalize);
		const op = String(operation);

		if (op === 'getAll') {
			return [
				{
					id: `hubspot:GET:${path}#0`,
					match: { method: 'GET', path },
					respond: { status: 200, body: { results } },
				},
			];
		}

		if (op === 'get') {
			return results.map(
				(r, i): Route => ({
					id: `hubspot:GET:${path}/${r.id}#${i}`,
					match: { method: 'GET', path: `${path}/${r.id}` },
					respond: { status: 200, body: r },
				}),
			);
		}

		if (op === 'create' || op === 'upsert') {
			return [
				{
					id: `hubspot:POST:${path}#0`,
					match: { method: 'POST', path },
					respond: { status: 201, body: results[0] },
				},
			];
		}

		if (op === 'search') {
			return [
				{
					id: `hubspot:POST:${path}/search#0`,
					match: { method: 'POST', path: `${path}/search` },
					respond: { status: 200, body: { total: results.length, results } },
				},
			];
		}

		return [];
	},
};
