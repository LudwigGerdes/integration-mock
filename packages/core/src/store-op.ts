import { applyFilters, getPath, readInput, type Row } from './filter.js';
import { isFormRequest, parseFormBody } from './form-body.js';
import { idempotencyKey, type RememberedResponse } from './idempotency.js';
import { followToken, paginate, sortRows } from './paginate.js';
import { applySoql, parseSoql, selectFields, type SoqlQuery } from './soql.js';
import type { ResourceStore } from './store.js';
import { renderTemplate, type TemplateContext } from './template.js';
import type { IdSpec, Layer, MockRequest, Resolution, Route, RouteResponse, ServicePack, StoreSpec } from './types.js';

export type StoreOutcome =
	| { kind: 'ok'; record?: Row; records?: Row[]; page?: Record<string, unknown> }
	| { kind: 'notFound' }
	| { kind: 'conflict'; error: string }
	| { kind: 'badRequest'; error: string };

const isPlain = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The body a store op works on: a form body parsed with brackets, JSON as sent. */
export function requestBody(req: MockRequest): unknown {
	return isFormRequest(req) && typeof req.body === 'string' ? parseFormBody(req.body) : req.body;
}

/** The record id of a get/update/delete: `idParam`, else the path's only param. */
function idFrom(spec: StoreSpec, params: Record<string, string>): string | undefined {
	if (spec.idParam !== undefined) return params[spec.idParam];
	const values = Object.values(params);
	return values.length === 1 ? values[0] : undefined;
}

/** Turn form-encoded strings into the types the vendor returns, for the fields `coerce` names. */
function coerced(record: Row, coerce: StoreSpec['coerce']): Row | undefined {
	if (coerce === undefined) return undefined;
	const patch: Row = {};
	for (const [field, type] of Object.entries(coerce)) {
		const v = record[field];
		if (typeof v !== 'string') continue;
		if (type === 'number' && v.trim() !== '' && Number.isFinite(Number(v))) patch[field] = Number(v);
		if (type === 'boolean' && (v === 'true' || v === 'false')) patch[field] = v === 'true';
	}
	return Object.keys(patch).length === 0 ? undefined : patch;
}

/** The object a create/update stores; an absent body is `{}`, anything not an object is refused. */
function objectBody(body: unknown): Row | undefined {
	if (body === undefined || body === null || body === '') return {};
	return isPlain(body) ? body : undefined;
}

export function runStoreOp(
	spec: StoreSpec,
	req: MockRequest,
	params: Record<string, string>,
	store: ResourceStore,
	body: unknown = requestBody(req),
): StoreOutcome {
	if (spec.op === 'list') return listOp(spec, req, params, store, body);

	const collection = spec.collection === undefined ? undefined : store.resolveCollection(spec.collection);
	if (collection === undefined) return { kind: 'badRequest', error: 'this route names no collection' };

	if (spec.op === 'create') {
		const item = objectBody(body);
		if (item === undefined) return { kind: 'badRequest', error: 'expected a JSON object body' };
		const given = item[store.idField(collection)];
		if (given !== undefined && given !== null && store.get(collection, String(given)) !== undefined) {
			return { kind: 'conflict', error: `a record with id ${String(given)} already exists` };
		}
		let record = store.create(collection, item);
		if (spec.stamp !== undefined) {
			const stamped = renderTemplate(spec.stamp, { request: req, params, count: 1, extra: { record } });
			if (isPlain(stamped)) record = store.updateRecord(collection, String(record[store.idField(collection)]), stamped, 'merge') ?? record;
		}
		const typed = coerced(record, spec.coerce);
		if (typed !== undefined) record = store.updateRecord(collection, String(record[store.idField(collection)]), typed, 'merge') ?? record;
		return { kind: 'ok', record };
	}

	const id = idFrom(spec, params);
	if (id === undefined) return { kind: 'notFound' };

	if (spec.op === 'get') {
		const record = store.get(collection, id);
		return record === undefined ? { kind: 'notFound' } : { kind: 'ok', record };
	}
	if (spec.op === 'update') {
		const patch = objectBody(body);
		if (patch === undefined) return { kind: 'badRequest', error: 'expected a JSON object body' };
		let record = store.updateRecord(collection, id, patch, spec.update ?? 'merge');
		if (record === undefined) return { kind: 'notFound' };
		const typed = coerced(record, spec.coerce);
		if (typed !== undefined) record = store.updateRecord(collection, id, typed, 'merge') ?? record;
		return { kind: 'ok', record };
	}
	const record = store.get(collection, id);
	if (record === undefined) return { kind: 'notFound' };
	store.delete(collection, id);
	return { kind: 'ok', record };
}

function listOp(spec: StoreSpec, req: MockRequest, params: Record<string, string>, store: ResourceStore, body: unknown): StoreOutcome {
	const pagination = spec.pagination;
	const read = (name: string): string | undefined => {
		const v = pagination?.in === 'body' ? getPath(body, name) : req.query[name];
		return v === undefined || v === null ? undefined : String(v);
	};
	const nextUrl = (token: string): string =>
		String(renderTemplate(pagination?.nextUrlTemplate ?? '', { request: req, params, count: 1, extra: { token } }));

	if (pagination?.style === 'nextUrl' && pagination.tokenParam !== undefined) {
		const id = params[pagination.tokenParam] ?? req.query[pagination.tokenParam];
		const token = id === undefined ? undefined : store.tokens.get(id);
		if (token === undefined) return { kind: 'badRequest', error: 'invalid cursor' };
		const followed = followToken(token, (rid) => store.get(token.collection, rid), { tokens: store.tokens, nextUrl });
		return { kind: 'ok', records: selectFields(followed.rows, token.fields ?? '*', store.idField(token.collection)), page: followed.page };
	}

	let collection = spec.collection === undefined ? undefined : store.resolveCollection(spec.collection);
	let soql: SoqlQuery | undefined;
	for (const f of spec.filters ?? []) {
		if (!('style' in f) || f.style !== 'soql') continue;
		const input = readInput(f.from, req, body, params);
		if (typeof input !== 'string' || input === '') continue;
		const parsed = parseSoql(input);
		if (!parsed.ok) return { kind: 'badRequest', error: parsed.error };
		soql = parsed.query;
		collection = store.knows(soql.from);
		// Real Salesforce answers INVALID_TYPE; an empty 200 would let the
		// workflow carry on as though the query had matched nothing.
		if (collection === undefined) return { kind: 'badRequest', error: `sObject type '${soql.from}' is not supported by this pack` };
	}
	if (collection === undefined) return { kind: 'badRequest', error: 'this route names no collection' };

	let rows = [...store.view(collection)];
	if (soql !== undefined) rows = applySoql(rows, soql);
	const filtered = applyFilters(rows, spec.filters ?? [], req, body, params);
	if (!filtered.ok) return { kind: 'badRequest', error: filtered.error };
	const idField = store.idField(collection);
	const paged = paginate(sortRows(filtered.rows, pagination?.sort), pagination, {
		read,
		idField,
		tokens: store.tokens,
		nextUrl,
		collection,
		...(soql !== undefined ? { fields: soql.fields } : {}),
	});
	if (!paged.ok) return { kind: 'badRequest', error: paged.error };
	// Filtering ran over the live records; only the page that leaves is copied.
	return { kind: 'ok', records: structuredClone(selectFields(paged.rows, soql?.fields ?? '*', idField)), page: paged.page };
}

export interface StoreRouteArgs {
	service: string;
	route: Route;
	chosen: RouteResponse;
	spec: StoreSpec;
	req: MockRequest;
	params: Record<string, string>;
	store: ResourceStore;
	count: number;
	layer: Exclude<Layer, 'store'>;
}

const NOT_FOUND: RouteResponse = { status: 404, body: { error: 'not found' } };
const CONFLICT_MESSAGE = 'idempotency key reused with different parameters';
const CONFLICT: RouteResponse = { status: 409, body: { error: CONFLICT_MESSAGE } };

function render(resp: RouteResponse, ctx: TemplateContext): { status: number; headers: Record<string, string>; body: unknown } {
	const body = resp.template === true ? renderTemplate(resp.body, ctx) : resp.body;
	const headers = resp.template === true ? (renderTemplate(resp.headers ?? {}, ctx) as Record<string, string>) : (resp.headers ?? {});
	return { status: resp.status, headers: { 'content-type': 'application/json', ...headers }, body };
}

/** Serve a matched store route: idempotency → store op → render `respond` with the result. */
export function serveStoreRoute(a: StoreRouteArgs): Resolution {
	const matched = { routeId: a.route.id, layer: a.layer };
	const base = { request: a.req, params: a.params, count: a.count };
	const scope = `${a.service}/${a.route.id}`;
	const body = requestBody(a.req);
	const key = a.spec.idempotency === undefined ? undefined : idempotencyKey(a.spec.idempotency, a.req, body);

	if (key !== undefined) {
		const seen = a.store.idempotency.lookup(scope, key, a.req.body);
		if (seen.kind === 'hit') return { ...seen.response, matched };
		if (seen.kind === 'conflict') return { ...render(a.spec.conflict ?? CONFLICT, { ...base, extra: { error: CONFLICT_MESSAGE } }), matched };
	}

	// Stripe saves the result of any request whose endpoint began executing, errors
	// included, and nothing for one that failed validation
	// (https://docs.stripe.com/api/idempotent_requests).
	const remember = (r: RememberedResponse): Resolution => {
		if (key !== undefined) a.store.idempotency.remember(scope, key, a.req.body, r);
		return { ...r, matched };
	};

	const outcome = runStoreOp(a.spec, a.req, a.params, a.store, body);
	if (outcome.kind === 'notFound') {
		return remember(render(a.spec.notFound ?? NOT_FOUND, { ...base, extra: { error: 'not found' } }));
	}
	if (outcome.kind === 'conflict') {
		return remember(render(a.spec.conflict ?? { status: 409, body: { error: outcome.error } }, { ...base, extra: { error: outcome.error } }));
	}
	if (outcome.kind === 'badRequest') {
		const resp = a.spec.badRequest ?? { status: 400, body: { error: outcome.error } };
		return { ...render(resp, { ...base, extra: { error: outcome.error } }), matched };
	}

	return remember(
		render(a.chosen, {
			...base,
			extra: { record: outcome.record, records: outcome.records, page: outcome.page ?? {} },
		}),
	);
}

/** The id field and format of each collection, from the first store spec that names one. */
export function idSpecsFor(packs: ServicePack[]): Record<string, IdSpec> {
	const out: Record<string, IdSpec> = {};
	const visit = (spec: StoreSpec | undefined): void => {
		if (spec?.collection !== undefined && spec.id !== undefined && out[spec.collection] === undefined) out[spec.collection] = spec.id;
	};
	for (const pack of packs) {
		for (const route of pack.routes) {
			visit(route.store);
			visit(route.respond?.store);
			for (const entry of route.sequence ?? []) visit(entry.store);
		}
	}
	return out;
}
