import type { Command } from 'commander';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
	compareRoute,
	isSafe,
	loadLayer,
	loadProjectConfig,
	mockHome,
	projectPacksDir,
	redact,
	savePack,
	type Route,
	type RouteFinding,
	type ServicePack,
} from 'integration-mock-core';
import { realFetcher, type Fetcher } from './verify-fetch.js';
import type { CliIo } from '../index.js';

/** `:name` segments a concrete request would have to fill in. */
const paramsOf = (path: string): string[] =>
	path
		.split('/')
		.filter((s) => s.startsWith(':'))
		.map((s) => s.slice(1));

const hasWildcard = (path: string): boolean =>
	path.split('/').some((s) => s === '*' || s === '**' || s.includes('*'));

/** Concrete URL for a route, or null when it cannot be made concrete. */
export function urlFor(
	baseUrl: string,
	route: Route,
	params: Record<string, string>,
): string | null {
	if (hasWildcard(route.match.path)) return null;
	const missing = paramsOf(route.match.path).filter((p) => params[p] === undefined);
	if (missing.length > 0) return null;

	const path = route.match.path
		.split('/')
		.map((s) => (s.startsWith(':') ? params[s.slice(1)]! : s))
		.join('/');
	const u = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
	for (const [k, v] of Object.entries(route.match.query ?? {})) u.searchParams.set(k, v);
	return u.toString();
}

export function registerVerify(program: Command, io: CliIo, fetcher: Fetcher = realFetcher): void {
	program
		.command('verify <service>')
		.description('compare a pack against the real vendor once you have access')
		.requiredOption('--base-url <url>', "the vendor's real base URL")
		.option('--header <kv>', 'request header, "Name: value"; repeatable',
			(v: string, prev: string[]) => [...prev, v], [] as string[])
		.option('--param <kv>', 'fill a :name path segment, "name=value"; repeatable',
			(v: string, prev: string[]) => [...prev, v], [] as string[])
		.option('--unsafe', 'also replay non-read methods — these have real side effects')
		.option('--patch', 'rewrite response bodies from what the vendor returned')
		.option('--json', 'machine-readable findings')
		.action(async (service: string, o: {
			baseUrl: string; header: string[]; param: string[];
			unsafe?: boolean; patch?: boolean; json?: boolean;
		}) => {
			const projectDir = join(projectPacksDir(), service);
			const userDir = join(mockHome(), 'packs', service);
			const proj = await loadProjectConfig();
			const [user, project] = await Promise.all([
				loadLayer(join(mockHome(), 'packs')),
				loadLayer(projectPacksDir()),
			]);
			const pack: ServicePack | undefined = [...project, ...user].find((p) => p.id === service);
			if (pack === undefined) throw new Error(`integration-mock: no pack "${service}" to verify`);

			const headers: Record<string, string> = {};
			for (const h of o.header) {
				const i = h.indexOf(':');
				if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
			}
			const params: Record<string, string> = {};
			for (const p of o.param) {
				const i = p.indexOf('=');
				if (i > 0) params[p.slice(0, i)] = p.slice(i + 1);
			}

			const findings: RouteFinding[] = [];
			const patched: Route[] = [];

			for (const route of pack.routes) {
				if (!isSafe(route) && o.unsafe !== true) {
					findings.push({
						route: route.id,
						kind: 'skipped',
						message: `${route.match.method} has side effects; pass --unsafe to include it`,
					});
					patched.push(route);
					continue;
				}
				const url = urlFor(o.baseUrl, route, params);
				if (url === null) {
					findings.push({
						route: route.id,
						kind: 'skipped',
						message: `cannot build a concrete request for ${route.match.path} — supply --param, or the pattern uses a wildcard`,
					});
					patched.push(route);
					continue;
				}

				const actual = await fetcher({ method: route.match.method, url, headers });
				const found = compareRoute(route, actual);
				findings.push(...found);

				if (o.patch === true && !('error' in actual) && route.respond !== undefined) {
					// Bodies only: a matcher change alters which requests are served
					// and is a human's call.
					// The vendor's real body goes into a committed pack: strip credentials first.
					patched.push({ ...route, respond: { ...route.respond, body: redact(actual.body, { paths: proj.redact }) } });
				} else {
					patched.push(route);
				}
			}

			if (o.json === true) {
				io.write(JSON.stringify(findings, null, 2));
			} else if (findings.length === 0) {
				io.write(`ok — ${pack.routes.length} route(s) agree with the vendor`);
			} else {
				// Count agreement explicitly. A report of nothing but skips reads
				// as though nothing worked, when in fact every route that could be
				// checked passed.
				const flagged = new Set(findings.map((f) => f.route));
				const agreed = pack.routes.filter((r) => !flagged.has(r.id)).length;
				const skipped = findings.filter((f) => f.kind === 'skipped').length;
				const real = findings.length - skipped;
				io.write(
					`${agreed} agreed, ${real} difference(s), ${skipped} skipped — of ${pack.routes.length} route(s)`,
				);
				for (const f of findings) {
					io.write(`${f.kind.padEnd(11)} ${f.route}: ${f.message}`);
					for (const d of f.diffs ?? []) {
						io.write(`             ${d.kind} ${d.path}${d.mock ? ` (pack: ${d.mock})` : ''}${d.real ? ` (real: ${d.real})` : ''}`);
					}
				}
			}

			if (o.patch === true) {
				const dir = existsSync(projectDir) ? projectDir : userDir;
				await savePack(dir, { ...pack, routes: patched });
				io.write(`patched ${dir} — review with \`git diff\``);
			}
		});
}
