const R = '[REDACTED]';
const KEY_RE = /^(authorization|cookie|set-cookie|x-api-key|x-n8n-api-key)$/i;
const TOKEN_RE = /^(?:Bearer\s+)?[A-Za-z0-9_-]{20,}$/;

function pathMatches(path: string[], pattern: string): boolean {
	const segs = pattern.replace(/\[\*\]/g, '.*').split('.').filter(Boolean);
	if (segs.length !== path.length) return false;
	return segs.every((s, i) => s === '*' || s === path[i]);
}

/**
 * Redact secrets from a value without mutating it.
 *
 * Snapshots and recordings contain real API responses, so this runs over
 * everything written to disk: well-known credential header names, token-shaped
 * strings, plus any caller-supplied dotted paths and regexes.
 */
export function redact<T>(value: T, rules: { paths?: string[]; patterns?: RegExp[] } = {}): T {
	const patterns = [TOKEN_RE, ...(rules.patterns ?? [])];
	const paths = rules.paths ?? [];

	const walk = (v: unknown, path: string[]): unknown => {
		if (paths.some((p) => pathMatches(path, p))) return R;
		if (typeof v === 'string') return patterns.some((re) => re.test(v)) ? R : v;
		if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)]));
		if (v && typeof v === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
				out[k] = KEY_RE.test(k) ? R : walk(x, [...path, k]);
			}
			return out;
		}
		return v;
	};

	return walk(value, []) as T;
}
