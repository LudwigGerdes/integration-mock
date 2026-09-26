import { matchPath, matchRoute } from './matcher.js';
import { renderTemplate } from './template.js';
import type { Layer, MockRequest, Resolution, RouteResponse, ServicePack } from './types.js';
import type { ResourceStore } from './store.js';

/** How many times each route has answered, keyed `<service>/<route id>`. Owned by the engine. */
export type CallCounters = Map<string, number>;

export interface LayeredPacks {
	library: ServicePack[];
	user: ServicePack[];
	project: ServicePack[];
	snapshot: ServicePack[];
}

/** Resolution order: most specific layer first. */
const ORDER: Array<Exclude<Layer, 'store'>> = ['snapshot', 'project', 'user', 'library'];

function hostMatches(domain: string, host: string): boolean {
	if (domain.startsWith('*.')) {
		const base = domain.slice(2);
		return host === base || host.endsWith('.' + base);
	}
	return domain === host;
}

const all = (p: LayeredPacks): ServicePack[] => ORDER.flatMap((l) => p[l]);

/** Which service owns this hostname (proxy mode)? Enablement is the caller's concern. */
export function serviceForHost(packs: LayeredPacks, host: string): string | null {
	for (const pk of all(packs)) if (pk.domains.some((d) => hostMatches(d, host))) return pk.id;
	return null;
}

/** Which service owns this path prefix (base-URL mode), and what is the remaining path? */
export function serviceForPrefix(
	packs: LayeredPacks,
	path: string,
): { service: string; rest: string } | null {
	for (const pk of all(packs)) {
		if (path === pk.prefix || path.startsWith(pk.prefix + '/')) {
			return { service: pk.id, rest: path.slice(pk.prefix.length) || '/' };
		}
	}
	return null;
}

/** The 501 response served when nothing matched — fails loud rather than reaching production. */
export function unmatched(service: string, req: MockRequest): Resolution {
	return {
		status: 501,
		headers: { 'content-type': 'application/json' },
		matched: 'unmatched',
		body: {
			error: 'integration-mock: no route',
			service,
			method: req.method,
			path: req.path,
			hint: `run \`integration-mock record\` or add to ./.integration-mock/packs/${service}`,
		},
	};
}

/**
 * Resolve a request against the layered packs, falling back to the generic
 * resource store and finally to a loud 501.
 */
export function resolve(
	packs: LayeredPacks,
	service: string,
	req: MockRequest,
	store: ResourceStore,
	counters: CallCounters = new Map(),
): Resolution {
	for (const layer of ORDER) {
		for (const pk of packs[layer]) {
			if (pk.id !== service) continue;
			for (const route of pk.routes) {
				if (!matchRoute(route, req)) continue;
				// Handler routes are executed from phase 3 onward; until then they are skipped.
				if (!route.respond && !route.sequence?.length) continue;
				const key = `${service}/${route.id}`;
				const count = (counters.get(key) ?? 0) + 1;
				counters.set(key, count);
				const chosen: RouteResponse | undefined =
					route.sequence?.[count - 1] ?? route.respond ?? route.sequence?.at(-1);
				if (chosen === undefined) continue;
				const ctx = { request: req, params: matchPath(route.match.path, req.path) ?? {}, count };
				const body = chosen.template === true ? renderTemplate(chosen.body, ctx) : chosen.body;
				const headers =
					chosen.template === true
						? (renderTemplate(chosen.headers ?? {}, ctx) as Record<string, string>)
						: (chosen.headers ?? {});
				return {
					status: chosen.status,
					headers: { 'content-type': 'application/json', ...headers },
					body,
					matched: { routeId: route.id, layer },
				};
			}
		}
	}
	return store.handle(req) ?? unmatched(service, req);
}
