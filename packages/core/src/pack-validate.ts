import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { pathSubsumes } from './matcher.js';
import { PACK_SCHEMA } from './pack-schema.js';
import type { Route, ServicePack } from './types.js';

interface AjvLike {
	compile(schema: object): ValidateFunction;
}
type AjvConstructor = new (opts?: { strict?: boolean; allErrors?: boolean }) => AjvLike;

/**
 * ajv ships CommonJS. Under Node ESM the default import resolves to
 * `module.exports`, whose constructor sits on `.default`; under esbuild (which
 * vitest uses) the interop shim has already unwrapped it. Accept either, or the
 * code compiles and runs in only one of the two.
 */
const ajvModule = Ajv2020 as unknown as AjvConstructor & { default?: AjvConstructor };
const AjvCtor: AjvConstructor = ajvModule.default ?? ajvModule;

export interface PackProblem {
	level: 'error' | 'warning';
	code: string;
	message: string;
	route?: string;
}

const validateSchema = new AjvCtor({ strict: false, allErrors: true }).compile(PACK_SCHEMA as object);

/**
 * The gate that makes an agent-authored pack trustworthy.
 *
 * Errors are things that will not work; warnings are things that will work but
 * probably do not do what the author meant. The split matters because the
 * authoring loop should iterate until the errors are gone, not until the output
 * is silent — a pack that only ever succeeds is legal, and usually wrong.
 */
/** Every key/value in `a` also present in `b` — so `a` constrains no more than `b`. */
const queryNoNarrower = (a?: Record<string, string>, b?: Record<string, string>): boolean =>
	Object.entries(a ?? {}).every(([k, v]) => (b ?? {})[k] === v);

/**
 * Would route `a`, placed earlier, take every request route `b` could serve?
 *
 * Conservative on bodyMatch: a route constrained by a body is only treated as
 * covering another when the constraint is identical, so an unclear case stays
 * silent rather than accusing a live route of being dead.
 */
function covers(a: Route, b: Route): boolean {
	if (a.match.method !== '*' && a.match.method !== b.match.method) return false;
	if (!pathSubsumes(a.match.path, b.match.path)) return false;
	if (!queryNoNarrower(a.match.query, b.match.query)) return false;
	if (a.match.bodyMatch !== undefined) {
		return JSON.stringify(a.match.bodyMatch) === JSON.stringify(b.match.bodyMatch);
	}
	return true;
}

export function validatePack(
	pack: unknown,
	opts: { others?: ServicePack[] } = {},
): PackProblem[] {
	const problems: PackProblem[] = [];

	if (!validateSchema(pack)) {
		for (const e of validateSchema.errors ?? []) {
			problems.push({
				level: 'error',
				code: 'schema',
				message: `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
			});
		}
		// Structural failure makes every semantic check unreliable — the shape
		// they assume is not there. Report and stop.
		return problems;
	}

	const p = pack as ServicePack;

	const seenIds = new Set<string>();
	const earlier: Route[] = [];
	for (const r of p.routes) {
		if (seenIds.has(r.id)) {
			problems.push({
				level: 'error',
				code: 'duplicate-route-id',
				message: `two routes share the id "${r.id}"`,
				route: r.id,
			});
		}
		seenIds.add(r.id);

		// Matching takes the first hit, so a route already covered by an earlier
		// one never serves. Silent dead weight is worse than a loud error, and
		// this must see through the pattern grammar: `/things/:id` above
		// `/things/describe` is the same defect as an outright duplicate.
		const shadower = earlier.find((e) => covers(e, r));
		if (shadower !== undefined) {
			problems.push({
				level: 'error',
				code: 'shadowed-route',
				message: `"${r.id}" can never serve: "${shadower.id}" (${shadower.match.method} ${shadower.match.path}) matches first`,
				route: r.id,
			});
		}
		earlier.push(r);

		if (r.respond === undefined && r.handler === undefined) {
			problems.push({
				level: 'warning',
				code: 'inert-route',
				message: `"${r.id}" has neither respond nor handler`,
				route: r.id,
			});
		}
	}

	for (const other of opts.others ?? []) {
		if (other.id === p.id) continue;
		if (other.prefix === p.prefix) {
			problems.push({
				level: 'error',
				code: 'prefix-collision',
				message: `prefix ${p.prefix} is already served by "${other.id}"`,
			});
		}
		const shared = p.domains.filter((d) => other.domains.includes(d));
		if (shared.length > 0) {
			problems.push({
				level: 'error',
				code: 'domain-collision',
				message: `domain(s) ${shared.join(', ')} already claimed by "${other.id}"`,
			});
		}
	}

	if (p.routes.length > 0 && !p.routes.some((r) => (r.respond?.status ?? 200) >= 400)) {
		problems.push({
			level: 'warning',
			code: 'no-error-routes',
			message: 'every route succeeds — the pack cannot exercise failure handling',
		});
	}

	return problems;
}
