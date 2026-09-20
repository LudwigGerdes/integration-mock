import { matchRoute } from './matcher.js';
import type { Layer, MockRequest, Resolution, ServicePack } from './types.js';
import type { ResourceStore } from './store.js';

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
): Resolution {
	for (const layer of ORDER) {
		for (const pk of packs[layer]) {
			if (pk.id !== service) continue;
			for (const route of pk.routes) {
				if (!matchRoute(route, req)) continue;
				// Handler routes are executed from phase 3 onward; until then they are skipped.
				if (!route.respond) continue;
				return {
					status: route.respond.status,
					headers: { 'content-type': 'application/json', ...route.respond.headers },
					body: route.respond.body,
					matched: { routeId: route.id, layer },
				};
			}
		}
	}
	return store.handle(req) ?? unmatched(service, req);
}
