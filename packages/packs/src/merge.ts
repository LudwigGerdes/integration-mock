import type { Route, ServicePack } from 'integration-mock-core';

/**
 * Combine several generated packs into one service.
 *
 * Some vendors publish one spec per API rather than one per product — HubSpot
 * ships 117 — so a single pack has to be assembled from several documents. The
 * first occurrence of a `method:path` wins: vendors repeat common endpoints
 * across their specs, and the resolver takes the first match anyway, so a second
 * copy would shadow nothing and only inflate the pack.
 */
export function mergePacks(
	id: string,
	packs: ServicePack[],
): { pack: ServicePack; duplicates: number } {
	const domains = [...new Set(packs.flatMap((p) => p.domains))];
	const seen = new Set<string>();
	const routes: Route[] = [];
	let duplicates = 0;

	for (const p of packs) {
		for (const r of p.routes) {
			const key = `${r.match.method}:${r.match.path}`;
			if (seen.has(key)) {
				duplicates++;
				continue;
			}
			seen.add(key);
			routes.push(r);
		}
	}

	const seed = packs.find((p) => p.seed)?.seed;
	return {
		pack: {
			id,
			domains,
			prefix: `/${id}`,
			routes,
			source: 'openapi',
			...(seed ? { seed } : {}),
		},
		duplicates,
	};
}
