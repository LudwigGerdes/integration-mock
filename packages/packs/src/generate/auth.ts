import type { Route } from 'integration-mock-core';
import type { OpenApiDoc, SecurityScheme } from './openapi.js';

const TOKEN_BODY = {
	access_token: 'mock-access-token',
	token_type: 'Bearer',
	expires_in: 3600,
	refresh_token: 'mock-refresh-token',
	scope: '',
};

const pathOf = (url: string): string | null => {
	try {
		return new URL(url).pathname;
	} catch {
		return null;
	}
};

/**
 * Canned success for the endpoints a client must call before anything else.
 *
 * Driven by `securitySchemes` rather than by guessing at path names: a spec that
 * declares an oauth2 flow states exactly which URL to mock. Bearer and apiKey
 * schemes have no endpoint to call, so they correctly yield nothing.
 */
export function authRoutes(doc: OpenApiDoc, service: string, basePath: string): Route[] {
	const schemes = (doc.components?.securitySchemes ?? {}) as Record<string, SecurityScheme>;
	const paths = new Set<string>();

	for (const scheme of Object.values(schemes)) {
		if (scheme?.type !== 'oauth2') continue;
		for (const flow of Object.values(scheme.flows ?? {})) {
			for (const url of [flow.tokenUrl, flow.refreshUrl]) {
				if (url === undefined) continue;
				const p = pathOf(url);
				if (p !== null) paths.add(p);
			}
		}
	}

	return [...paths].sort().map((p) => ({
		id: `${service}:POST:${p}#auth`,
		match: { method: 'POST' as const, path: p.startsWith(basePath) ? p : basePath + p },
		respond: { status: 200, body: TOKEN_BODY },
	}));
}
