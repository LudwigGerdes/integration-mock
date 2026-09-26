import { randomUUID } from 'node:crypto';
import type { MockRequest } from './types.js';

/**
 * Response templating: a small, closed vocabulary rendered into a route's
 * body and headers when the route opts in with `template: true`.
 *
 *   {{request.body.customer.id}}   a value from the request (body, query,
 *   {{request.query.page}}         params, headers, path, method); a whole-
 *   {{request.params.id}}          string template yields the value itself,
 *   {{request.headers.x-req-id}}   so `"{{request.body}}"` echoes an object
 *   {{uuid}}                       a fresh v4 id
 *   {{now}}                        ISO time; {{timestamp}} is epoch seconds
 *   {{counter}}                    how many times this route has answered, from 1
 *
 * Opt-in, because a recorded body may legitimately contain `{{…}}` (a Slack
 * message template, a Handlebars snippet) that must replay untouched. No
 * expressions, no code: an unknown placeholder is left as written.
 */
export interface TemplateContext {
	request: MockRequest;
	/** `:name` segments of the matched path. */
	params: Record<string, string>;
	/** 1-based count of this route's answers, including this one. */
	count: number;
	now?: () => Date;
	uuid?: () => string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.\-[\]]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z0-9_.\-[\]]+)\s*\}\}$/;

const lookup = (root: unknown, path: string[]): unknown => {
	let cur = root;
	for (const key of path) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
};

/** The value a placeholder names, or undefined when it names nothing. */
function evaluate(name: string, ctx: TemplateContext): unknown {
	const [head, ...rest] = name.split('.');
	switch (head) {
		case 'uuid':
			return (ctx.uuid ?? randomUUID)();
		case 'now':
			return (ctx.now ?? (() => new Date()))().toISOString();
		case 'timestamp':
			return Math.floor((ctx.now ?? (() => new Date()))().getTime() / 1000);
		case 'counter':
			return ctx.count;
		case 'request': {
			const [part, ...path] = rest;
			switch (part) {
				case 'body':
					return lookup(ctx.request.body, path);
				case 'query':
					return lookup(ctx.request.query, path);
				case 'params':
					return lookup(ctx.params, path);
				case 'headers':
					return lookup(ctx.request.headers, path.map((p) => p.toLowerCase()));
				case 'path':
					return path.length === 0 ? ctx.request.path : undefined;
				case 'method':
					return path.length === 0 ? ctx.request.method : undefined;
				default:
					return undefined;
			}
		}
		default:
			return undefined;
	}
}

const asText = (v: unknown): string =>
	v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Render every string in `value`, recursively; other leaves pass through. */
export function renderTemplate(value: unknown, ctx: TemplateContext): unknown {
	if (typeof value === 'string') {
		const whole = WHOLE.exec(value);
		if (whole) {
			const v = evaluate(whole[1]!, ctx);
			return v === undefined ? value : v;
		}
		return value.replace(PLACEHOLDER, (m, name: string) => {
			const v = evaluate(name, ctx);
			return v === undefined ? m : asText(v);
		});
	}
	if (Array.isArray(value)) return value.map((v) => renderTemplate(v, ctx));
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renderTemplate(v, ctx)]),
		);
	}
	return value;
}
