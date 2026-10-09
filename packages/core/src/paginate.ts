import { compareValues, getPath, type Row } from './filter.js';
import type { PaginationSpec } from './types.js';

/** What a `nextUrl` token stands for: a snapshot of the matching ids and where the next page starts. */
export interface PageToken {
	collection: string;
	ids: string[];
	offset: number;
	limit: number;
	fields?: string[] | '*';
}

/** Tokens kept per store; the oldest is evicted past this. */
const MAX_TOKENS = 1000;

/** Opaque page tokens for `nextUrl` paging. Owned by the store, cleared with it. */
export class PageTokens {
	private next = 1;
	private tokens = new Map<string, PageToken>();

	issue(token: PageToken): string {
		const id = `mock${String(this.next++).padStart(6, '0')}-${token.offset}`;
		this.tokens.set(id, token);
		// A long-running daemon must not keep every snapshot it ever issued.
		if (this.tokens.size > MAX_TOKENS) this.tokens.delete(this.tokens.keys().next().value!);
		return id;
	}

	get size(): number {
		return this.tokens.size;
	}

	get(id: string): PageToken | undefined {
		return this.tokens.get(id);
	}

	clear(): void {
		this.tokens.clear();
		this.next = 1;
	}
}

export interface PageContext {
	/** A paging param from wherever the spec says (`in`). */
	read: (name: string) => string | undefined;
	idField: string;
	tokens: PageTokens;
	/** The follow-up URL for a `nextUrl` token. */
	nextUrl: (token: string) => string;
	collection: string;
	/** SOQL SELECT fields, carried in a `nextUrl` token so later pages trim the same way. */
	fields?: string[] | '*';
}

export type PageOutcome = { ok: true; rows: Row[]; page: Record<string, unknown> } | { ok: false; error: string };

type Parsed = { value: number | undefined } | { error: string };

/** A whole-number param; absent is fine, anything else below `min` or not a number is an error. */
function intParam(raw: string | undefined, name: string, min: number): Parsed {
	if (raw === undefined || raw === '') return { value: undefined };
	if (!/^\d+$/.test(raw) || Number(raw) < min) return { error: `invalid ${name}` };
	return { value: Number(raw) };
}

export function sortRows(rows: Row[], sort: PaginationSpec['sort']): Row[] {
	if (sort === undefined) return rows;
	const dir = sort.direction === 'desc' ? -1 : 1;
	return rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => dir * compareValues(getPath(a.row, sort.field), getPath(b.row, sort.field)) || a.index - b.index)
		.map((x) => x.row);
}

export function paginate(rows: Row[], spec: PaginationSpec | undefined, ctx: PageContext): PageOutcome {
	const total = rows.length;
	if (spec === undefined) return { ok: true, rows, page: { total, hasMore: false } };

	const limitParsed = intParam(spec.limitParam === undefined ? undefined : ctx.read(spec.limitParam), 'limit', 1);
	if ('error' in limitParsed) return { ok: false, error: limitParsed.error };
	const fallback = spec.defaultLimit ?? (spec.style === 'nextUrl' ? 2000 : 10);
	const limit = Math.min(limitParsed.value ?? fallback, spec.maxLimit ?? Number.MAX_SAFE_INTEGER);

	switch (spec.style) {
		case 'cursor': {
			const cursor = spec.cursorParam === undefined ? undefined : ctx.read(spec.cursorParam);
			let start = 0;
			if (cursor !== undefined && cursor !== '') {
				const at = rows.findIndex((r) => String(r[ctx.idField]) === cursor);
				if (at < 0) return { ok: false, error: 'invalid cursor' };
				start = at + 1;
			}
			const slice = rows.slice(start, start + limit);
			const hasMore = start + limit < total;
			const last = slice.at(-1);
			return {
				ok: true,
				rows: slice,
				page: { next: hasMore && last !== undefined ? String(last[ctx.idField]) : '', hasMore, total, limit },
			};
		}
		case 'offset': {
			const parsed = intParam(spec.offsetParam === undefined ? undefined : ctx.read(spec.offsetParam), 'offset', 0);
			if ('error' in parsed) return { ok: false, error: parsed.error };
			const offset = parsed.value ?? 0;
			const hasMore = offset + limit < total;
			return {
				ok: true,
				rows: rows.slice(offset, offset + limit),
				page: { offset, nextOffset: hasMore ? offset + limit : null, hasMore, total, limit },
			};
		}
		case 'page': {
			const parsed = intParam(spec.pageParam === undefined ? undefined : ctx.read(spec.pageParam), 'page', 1);
			if ('error' in parsed) return { ok: false, error: parsed.error };
			const number = parsed.value ?? 1;
			const totalPages = Math.max(1, Math.ceil(total / limit));
			const start = (number - 1) * limit;
			const hasMore = number < totalPages;
			return {
				ok: true,
				rows: rows.slice(start, start + limit),
				page: { number, nextNumber: hasMore ? number + 1 : null, totalPages, total, hasMore, limit },
			};
		}
		case 'nextUrl': {
			const hasMore = limit < total;
			const nextUrl = hasMore
				? ctx.nextUrl(
						ctx.tokens.issue({
							collection: ctx.collection,
							ids: rows.map((r) => String(r[ctx.idField])),
							offset: limit,
							limit,
							...(ctx.fields !== undefined ? { fields: ctx.fields } : {}),
						}),
					)
				: '';
			return { ok: true, rows: rows.slice(0, limit), page: { nextUrl, done: !hasMore, hasMore, total, limit } };
		}
	}
}

/** The page a `nextUrl` token points at; records deleted since it was issued are skipped. */
export function followToken(
	token: PageToken,
	lookup: (id: string) => Row | undefined,
	ctx: { tokens: PageTokens; nextUrl: (token: string) => string },
): { rows: Row[]; page: Record<string, unknown> } {
	const end = token.offset + token.limit;
	const rows = token.ids
		.slice(token.offset, end)
		.map(lookup)
		.filter((r): r is Row => r !== undefined);
	const hasMore = end < token.ids.length;
	const nextUrl = hasMore ? ctx.nextUrl(ctx.tokens.issue({ ...token, offset: end })) : '';
	return { rows, page: { nextUrl, done: !hasMore, hasMore, total: token.ids.length, limit: token.limit } };
}
