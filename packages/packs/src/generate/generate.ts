import type { HttpMethod, Route, ServicePack } from 'integration-mock-core';
import { authRoutes } from './auth.js';
import { derefDeep, resolveRef } from './deref.js';
import { fakeFromSchema, makeRng } from './fake.js';
import { sanitizeExamples } from './sanitize.js';
import {
	HTTP_METHODS,
	type MediaType,
	type OpenApiDoc,
	type Operation,
	type PathItem,
	type Response,
	type Schema,
} from './openapi.js';

/**
 * Size at which a generated body stops being a useful mock and starts being a
 * problem. Purely advisory — generation is unchanged, so packs stay
 * byte-identical between runs.
 *
 * `MAX_DEPTH` in the body generator bounds how deep expansion goes and says
 * nothing about how wide. A schema that is both produced DocuSign responses of
 * 264KB: the depth cap was doing its job and the body was still unusable. This
 * is the signal that would have surfaced that before 13MB of it was committed.
 */
const MAX_BODY_BYTES = 32_768;

export interface BuildReport {
	service: string;
	routes: number;
	skipped: Array<{ path: string; method: string; reason: string }>;
	warnings: string[];
}

export interface GenerateOptions {
	id: string;
	domains?: string[];
	prefix?: string;
	spec?: ServicePack['spec'];
}

/** OpenAPI templating (`{id}`) to the matcher's param syntax (`:id`). */
export const openApiPathToMatch = (p: string): string => p.replace(/\{([^}]+)\}/g, ':$1');

function serverParts(doc: OpenApiDoc): { hosts: string[]; basePath: string } {
	const hosts: string[] = [];
	let basePath = '';
	for (const [i, s] of (doc.servers ?? []).entries()) {
		try {
			const u = new URL(s.url);
			if (!hosts.includes(u.hostname)) hosts.push(u.hostname);
			if (i === 0) basePath = u.pathname.replace(/\/+$/, '');
		} catch {
			// Templated or relative server URL — nothing to derive from it.
		}
	}
	// Swagger 2.0 predates `servers`; without this fallback such a spec yields a
	// pack with no domains, which can never match a host.
	if (hosts.length === 0 && typeof doc.host === 'string' && doc.host !== '') {
		hosts.push(doc.host);
		basePath = (doc.basePath ?? '').replace(/\/+$/, '');
	}
	return { hosts, basePath };
}

/** `200`, else the lowest 2xx, else `default`. */
function pickResponse(op: Operation): { code: string; response: Response } | null {
	const responses = op.responses ?? {};
	if (responses['200']) return { code: '200', response: responses['200'] };
	const twoXx = Object.keys(responses)
		.filter((c) => /^2\d\d$/.test(c))
		.sort();
	const first = twoXx[0];
	if (first !== undefined) return { code: first, response: responses[first]! };
	if (responses.default) return { code: 'default', response: responses.default };
	return null;
}

function pickMedia(response: Response): MediaType | null {
	const content = response.content ?? {};
	const key = Object.keys(content).find((k) => k.includes('json')) ?? Object.keys(content)[0];
	if (key !== undefined) return content[key] ?? null;
	// Swagger 2.0: no `content` map, the schema is on the response itself.
	return response.schema !== undefined ? { schema: response.schema } : null;
}

/**
 * Turn an OpenAPI document into a replayable pack.
 *
 * Degrades rather than failing: a missing schema or unresolvable ref costs one
 * body, not the whole build, and everything lost is named in the report.
 */
export function generatePack(
	doc: OpenApiDoc,
	opts: GenerateOptions,
): { pack: ServicePack; report: BuildReport } {
	const { hosts, basePath } = serverParts(doc);
	const report: BuildReport = { service: opts.id, routes: 0, skipped: [], warnings: [] };
	const routes: Route[] = [];

	for (const rawPath of Object.keys(doc.paths ?? {}).sort()) {
		let item = doc.paths![rawPath]!;

		// A path item may itself be a $ref. Split specs point these at separate
		// remote documents, which we do not fetch — but dropping them silently
		// makes a spec of 181 paths report "routes 0" and look like it worked.
		const itemRef = (item as { $ref?: unknown }).$ref;
		if (typeof itemRef === 'string') {
			const resolved = resolveRef(doc, itemRef);
			if (resolved === null) {
				report.skipped.push({
					path: rawPath,
					method: '*',
					reason: `unresolvable external $ref: ${itemRef}`,
				});
				continue;
			}
			item = resolved as PathItem;
		}

		for (const method of HTTP_METHODS) {
			const op = item[method] as Operation | undefined;
			if (op === undefined || Array.isArray(op)) continue;
			const METHOD = method.toUpperCase() as HttpMethod;

			if (op.deprecated === true) {
				report.skipped.push({ path: rawPath, method: METHOD, reason: 'deprecated' });
				continue;
			}

			const picked = pickResponse(op);
			if (picked === null) {
				report.skipped.push({ path: rawPath, method: METHOD, reason: 'no response defined' });
				continue;
			}

			const status = picked.code === 'default' ? 200 : Number(picked.code);
			const media = pickMedia(picked.response);
			let body: unknown;
			if (media === null) {
				report.warnings.push(`${METHOD} ${rawPath}: no response content; serving an empty body`);
			} else if (media.example !== undefined) {
				body = media.example;
			} else {
				const named = Object.values(media.examples ?? {}).find((e) => e.value !== undefined);
				if (named !== undefined) {
					body = named.value;
				} else if (media.schema !== undefined) {
					const schema = derefDeep(doc, media.schema) as Schema;
					// Seeded per route, so one route's body never shifts because a
					// neighbouring operation was added or removed.
					body = fakeFromSchema(schema, makeRng(`${opts.id}:${METHOD}:${rawPath}`));
				} else {
					report.warnings.push(`${METHOD} ${rawPath}: no schema or example; serving an empty body`);
					body = {};
				}
			}

			if (body !== undefined) {
				// Specs ship credential-shaped examples (GitHub's `pem`, SendGrid's
				// signed S3 URL); replace them before they reach a committed pack.
				body = sanitizeExamples(body);
				const bytes = JSON.stringify(body).length;
				if (bytes > MAX_BODY_BYTES) {
					report.warnings.push(
						`${METHOD} ${rawPath}: generated body is ${Math.round(bytes / 1024)}KB — ` +
							'this schema is wide as well as deep, and the depth cap does not bound ' +
							'width. Prefer a hand-trimmed example, or drop the operation.',
					);
				}
			}

			const path = basePath + openApiPathToMatch(rawPath);
			routes.push({
				id: `${opts.id}:${METHOD}:${path}#0`,
				match: { method: METHOD, path },
				respond: { status, ...(body === undefined ? {} : { body }) },
			});
			report.routes++;
		}
	}

	const auth = authRoutes(doc, opts.id, basePath);
	report.routes += auth.length;

	const pack: ServicePack = {
		id: opts.id,
		domains: opts.domains ?? hosts,
		prefix: opts.prefix ?? `/${opts.id}`,
		// Prepended: the resolver takes the first match, and a canned 200 must beat
		// whatever error response the spec happens to document for the token endpoint.
		routes: [...auth, ...routes],
		source: 'openapi',
		...(opts.spec ? { spec: opts.spec } : {}),
	};
	if (pack.domains.length === 0) {
		report.warnings.push(
			'no servers in the spec; set domains manually or the pack will never match a host',
		);
	}
	return { pack, report };
}
