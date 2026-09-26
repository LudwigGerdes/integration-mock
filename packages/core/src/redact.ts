const R = '[REDACTED]';
/**
 * Keys whose value is a credential whatever it looks like: the standard auth
 * headers, the API-key headers vendors actually use (Azure APIM, GitLab, AWS,
 * generic `apikey`), and the query parameters OAuth and vendor SDKs put
 * tokens in. Matched case-insensitively on the key alone.
 */
const KEY_RE =
	/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|api_key|x-auth-token|x-n8n-api-key|private-token|ocp-apim-subscription-key|x-amz-security-token|token|access_token|refresh_token|id_token|client_secret|password|secret)$/i;
/** Opaque tokens: a long unbroken run of token characters, with or without `Bearer`. */
const TOKEN_RE = /^(?:Bearer\s+)?[A-Za-z0-9_-]{20,}$/;
/** JWTs: three base64url segments joined by dots; the dots defeat TOKEN_RE. */
const JWT_RE = /^(?:Bearer\s+)?[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
/** HTTP Basic: the scheme word plus base64, whose `=` padding defeats TOKEN_RE. */
const BASIC_RE = /^Basic\s+[A-Za-z0-9+/]{8,}={0,2}$/;

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
	const patterns = [TOKEN_RE, JWT_RE, BASIC_RE, ...(rules.patterns ?? [])];
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
