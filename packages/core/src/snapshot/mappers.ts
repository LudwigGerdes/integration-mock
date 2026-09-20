import type { HttpMethod, Route } from '../types.js';
import type { N8nNode } from './n8n-client.js';

/**
 * Turns what a node *produced* back into the vendor response(s) that would
 * produce it — the inverse of executing the node.
 */
export interface ReverseMapper {
	nodeType: string;
	service: string;
	/** Proxy-mode host match for the pack this mapper's routes land in. */
	domains?: string[];
	fromNodeOutput(node: N8nNode, outputs: unknown[]): Route[];
}

const registry = new Map<string, ReverseMapper>();

export function registerMapper(m: ReverseMapper): void {
	registry.set(m.nodeType, m);
}

export function mapperFor(nodeType: string): ReverseMapper | undefined {
	return registry.get(nodeType);
}

export const serviceIdForHost = (host: string): string =>
	host
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

const isExpr = (v: unknown): boolean => typeof v === 'string' && v.startsWith('=');

/** `null` when the URL is an expression — the path is not knowable statically. */
export function resolveNodeUrl(node: N8nNode): URL | null {
	const u = node.parameters.url;
	if (typeof u !== 'string' || isExpr(u)) return null;
	try {
		return new URL(u);
	} catch {
		return null;
	}
}

const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const httpRequestMapper: ReverseMapper = {
	nodeType: 'n8n-nodes-base.httpRequest',
	service: 'http',
	fromNodeOutput(node, outputs) {
		const url = resolveNodeUrl(node);
		if (!url) return [];
		const p = node.parameters;
		const method = (typeof p.method === 'string' ? p.method : 'GET').toUpperCase() as HttpMethod;
		const service = serviceIdForHost(url.hostname);

		const query: Record<string, string> = Object.fromEntries(url.searchParams);
		if (p.sendQuery) {
			const listed = obj(p.queryParameters).parameters as
				| Array<{ name: string; value: unknown }>
				| undefined;
			for (const q of listed ?? []) {
				// Expression values differ per item, so they cannot constrain the match.
				if (typeof q.value === 'string' && !isExpr(q.value)) query[q.name] = q.value;
			}
		}

		let bodyMatch: unknown;
		if (p.sendBody && p.specifyBody === 'json' && typeof p.jsonBody === 'string' && !isExpr(p.jsonBody)) {
			try {
				bodyMatch = JSON.parse(p.jsonBody);
			} catch {
				// not literal JSON; leave the match unconstrained
			}
		}

		const full = Boolean(obj(obj(obj(p.options).response).response).fullResponse);
		let status = 200;
		let body: unknown;
		if (full) {
			const first = obj(outputs[0]);
			body = first.body;
			status = typeof first.statusCode === 'number' ? first.statusCode : 200;
		} else {
			// n8n splits an array response into items; one item means the body was an object.
			body = outputs.length === 1 ? outputs[0] : outputs;
		}

		const match: Route['match'] = {
			method,
			path: url.pathname,
			...(Object.keys(query).length ? { query } : {}),
			...(bodyMatch !== undefined ? { bodyMatch } : {}),
		};
		return [{ id: `${service}:${method}:${url.pathname}#0`, match, respond: { status, body } }];
	},
};

registerMapper(httpRequestMapper);

/** Tests that assert on "no mapper" behaviour need a registry without the packs. */
export function __resetMappersForTests(): void {
	registry.clear();
	registerMapper(httpRequestMapper);
}
