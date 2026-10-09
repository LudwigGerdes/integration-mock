import { compare, compareValues, type Row } from './filter.js';
import type { FilterOp } from './types.js';

/**
 * A deliberately small SOQL subset:
 *   SELECT <fields|*> FROM <Type> [WHERE c [AND c]…] [ORDER BY f [ASC|DESC]] [LIMIT n]
 * with conditions `<field> <op> <literal>` (= != <> > >= < <=, LIKE '%x%').
 * Anything else is refused by name, never ignored: a filter the mock skipped
 * would hand back records the workflow did not ask for.
 */
export interface SoqlCondition {
	field: string;
	op: FilterOp;
	value: unknown;
}

export interface SoqlQuery {
	fields: string[] | '*';
	from: string;
	where: SoqlCondition[];
	orderBy?: { field: string; direction: 'asc' | 'desc' };
	limit?: number;
}

export type SoqlParse = { ok: true; query: SoqlQuery } | { ok: false; error: string };

type Token =
	| { kind: 'word'; text: string }
	| { kind: 'string'; text: string }
	| { kind: 'number'; value: number }
	| { kind: 'op'; text: string }
	| { kind: 'punct'; text: string };

const KEYWORDS = new Set([
	'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'GROUP',
	'HAVING', 'IN', 'LIKE', 'NULLS', 'TRUE', 'FALSE', 'NULL', 'INCLUDES', 'EXCLUDES', 'WITH', 'FOR', 'TYPEOF', 'USING',
]);
const OPS: Record<string, FilterOp> = { '=': 'eq', '!=': 'ne', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?/;

const unsupported = (what: string): SoqlParse => ({ ok: false, error: `${what} in SOQL is not supported by integration-mock` });
const fail = (error: string): SoqlParse => ({ ok: false, error });

function tokenize(text: string): Token[] | string {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === "'") {
			let s = '';
			i++;
			while (i < text.length && text[i] !== "'") {
				if (text[i] === '\\' && i + 1 < text.length) {
					s += text[i + 1];
					i += 2;
					continue;
				}
				s += text[i];
				i++;
			}
			if (i >= text.length) return 'an unterminated string';
			i++;
			tokens.push({ kind: 'string', text: s });
			continue;
		}
		const two = text.slice(i, i + 2);
		if (two === '!=' || two === '<>' || two === '>=' || two === '<=') {
			tokens.push({ kind: 'op', text: two === '<>' ? '!=' : two });
			i += 2;
			continue;
		}
		if (c === '=' || c === '<' || c === '>') {
			tokens.push({ kind: 'op', text: c });
			i++;
			continue;
		}
		if (c === ',' || c === '(' || c === ')' || c === '*') {
			tokens.push({ kind: 'punct', text: c });
			i++;
			continue;
		}
		const rest = text.slice(i);
		const date = DATE.exec(rest);
		if (date) {
			tokens.push({ kind: 'string', text: date[0] });
			i += date[0].length;
			continue;
		}
		const num = /^-?\d+(?:\.\d+)?/.exec(rest);
		if (num) {
			tokens.push({ kind: 'number', value: Number(num[0]) });
			i += num[0].length;
			continue;
		}
		const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
		if (word) {
			tokens.push({ kind: 'word', text: word[0] });
			i += word[0].length;
			continue;
		}
		return `the character "${c}"`;
	}
	return tokens;
}

const kw = (t: Token | undefined): string | undefined => (t?.kind === 'word' ? t.text.toUpperCase() : undefined);
const isPunct = (t: Token | undefined, ch: string): boolean => t?.kind === 'punct' && t.text === ch;
const describe = (t: Token): string =>
	t.kind === 'number' ? String(t.value) : t.kind === 'string' ? `'${t.text}'` : t.text;

export function parseSoql(text: string): SoqlParse {
	const lexed = tokenize(text);
	if (typeof lexed === 'string') return fail(`SOQL could not be read: ${lexed}`);
	const t = lexed;
	let i = 0;

	/** A field name at `t[i]`, or the reason it is not one. */
	const field = (): string | SoqlParse => {
		const tok = t[i];
		if (tok?.kind !== 'word' || KEYWORDS.has(tok.text.toUpperCase())) return fail('SOQL expected a field name');
		if (isPunct(t[i + 1], '(')) return unsupported('Functions');
		if (tok.text.includes('.')) return unsupported(`Relationship fields (${tok.text})`);
		i++;
		return tok.text;
	};

	if (kw(t[i]) !== 'SELECT') return fail('SOQL must start with SELECT');
	i++;
	let fields: string[] | '*';
	if (isPunct(t[i], '*')) {
		fields = '*';
		i++;
	} else {
		const list: string[] = [];
		for (;;) {
			const f = field();
			if (typeof f !== 'string') return f;
			list.push(f);
			if (!isPunct(t[i], ',')) break;
			i++;
		}
		fields = list;
	}

	if (kw(t[i]) !== 'FROM') return fail('SOQL expected FROM');
	i++;
	const from = t[i];
	if (from?.kind !== 'word' || KEYWORDS.has(from.text.toUpperCase())) return fail('SOQL expected an object after FROM');
	i++;

	const where: SoqlCondition[] = [];
	if (kw(t[i]) === 'WHERE') {
		i++;
		for (;;) {
			if (isPunct(t[i], '(')) return unsupported('Parentheses');
			if (kw(t[i]) === 'NOT') return unsupported('NOT');
			const f = field();
			if (typeof f !== 'string') return f;
			const opTok = t[i];
			const word = kw(opTok);
			if (word === 'IN' || word === 'INCLUDES' || word === 'EXCLUDES') return unsupported(word);
			if (word === 'LIKE') {
				i++;
				const pattern = t[i];
				if (pattern?.kind !== 'string') return fail('SOQL LIKE needs a quoted pattern');
				i++;
				const inner = /^%([^%]*)%$/.exec(pattern.text);
				if (inner) where.push({ field: f, op: 'contains', value: inner[1]! });
				else if (!pattern.text.includes('%')) where.push({ field: f, op: 'eq', value: pattern.text });
				else return unsupported(`LIKE '${pattern.text}'`);
			} else {
				if (opTok?.kind !== 'op') return fail(`SOQL expected an operator after ${f}`);
				const op = OPS[opTok.text]!;
				i++;
				const v = t[i];
				let value: unknown;
				if (v?.kind === 'string') value = v.text;
				else if (v?.kind === 'number') value = v.value;
				else if (kw(v) === 'TRUE') value = true;
				else if (kw(v) === 'FALSE') value = false;
				else if (kw(v) === 'NULL') value = null;
				else return fail(`SOQL expected a value after ${f} ${opTok.text}`);
				i++;
				where.push({ field: f, op, value });
			}
			if (kw(t[i]) === 'AND') {
				i++;
				continue;
			}
			if (kw(t[i]) === 'OR') return unsupported('OR');
			break;
		}
	}

	const clause = kw(t[i]);
	if (clause === 'GROUP' || clause === 'HAVING' || clause === 'OFFSET' || clause === 'WITH' || clause === 'FOR') return unsupported(clause);

	let orderBy: SoqlQuery['orderBy'];
	if (kw(t[i]) === 'ORDER') {
		i++;
		if (kw(t[i]) !== 'BY') return fail('SOQL expected BY after ORDER');
		i++;
		const f = field();
		if (typeof f !== 'string') return f;
		let direction: 'asc' | 'desc' = 'asc';
		if (kw(t[i]) === 'ASC') i++;
		else if (kw(t[i]) === 'DESC') {
			direction = 'desc';
			i++;
		}
		if (kw(t[i]) === 'NULLS') return unsupported('NULLS FIRST/LAST');
		if (isPunct(t[i], ',')) return unsupported('Ordering by more than one field');
		orderBy = { field: f, direction };
	}

	let limit: number | undefined;
	if (kw(t[i]) === 'LIMIT') {
		i++;
		const n = t[i];
		if (n?.kind !== 'number' || !Number.isInteger(n.value) || n.value < 0) return fail('SOQL LIMIT needs a whole number');
		limit = n.value;
		i++;
	}
	if (kw(t[i]) === 'OFFSET') return unsupported('OFFSET');
	const extra = t[i];
	if (extra !== undefined) return fail(`SOQL has something integration-mock does not understand near ${describe(extra)}`);

	return {
		ok: true,
		query: { fields, from: from.text, where, ...(orderBy ? { orderBy } : {}), ...(limit !== undefined ? { limit } : {}) },
	};
}

/** A top-level field, matched case-insensitively as SOQL does. */
export function fieldOf(row: Row, name: string): unknown {
	const lower = name.toLowerCase();
	const key = Object.keys(row).find((k) => k.toLowerCase() === lower);
	return key === undefined ? undefined : row[key];
}

/** WHERE, then ORDER BY (stable), then LIMIT. */
export function applySoql(rows: Row[], q: SoqlQuery): Row[] {
	let out = rows.filter((row) => q.where.every((c) => compare(c.op, fieldOf(row, c.field), c.value)));
	const order = q.orderBy;
	if (order !== undefined) {
		const dir = order.direction === 'desc' ? -1 : 1;
		out = out
			.map((row, index) => ({ row, index }))
			.sort((a, b) => dir * compareValues(fieldOf(a.row, order.field), fieldOf(b.row, order.field)) || a.index - b.index)
			.map((x) => x.row);
	}
	return q.limit === undefined ? out : out.slice(0, q.limit);
}

/** Trim records to the SELECTed fields; the id and Salesforce's `attributes` always stay. */
export function selectFields(rows: Row[], fields: string[] | '*', idField: string): Row[] {
	if (fields === '*') return rows;
	const wanted = new Set([...fields, idField, 'attributes'].map((f) => f.toLowerCase()));
	return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => wanted.has(k.toLowerCase()))));
}
