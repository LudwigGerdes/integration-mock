/** Injectable so install can be tested without reaching the network. */
export type PackFetcher = (url: string) => Promise<string>;

export const PACK_REPO = 'LudwigGerdes/integration-mock';

/** The environment variable that points \`packs install\` at a mirror. */
export const PACK_INDEX_URL_ENV = 'INTEGRATION_MOCK_PACK_INDEX_URL';

/**
 * Where packs are downloaded from: \`<base>/<id>/<file>\`. The default is this
 * repository at the release tag; \`INTEGRATION_MOCK_PACK_INDEX_URL\` replaces the
 * base with a mirror a team controls (an internal web server, an artifact
 * store), which is what an allow-listed network needs. The files are checked
 * against the release's own sha256 index either way.
 */
export const packBaseUrl = (ref: string): string => {
	const mirror = process.env[PACK_INDEX_URL_ENV];
	if (mirror !== undefined && mirror !== '') return mirror.replace(/\/+$/, '');
	return `https://raw.githubusercontent.com/${PACK_REPO}/${ref}/packages/packs/packs`;
};

/** Where a pack's file lives at a given ref (or on the configured mirror). */
export const packFileUrl = (ref: string, id: string, file: string): string =>
	`${packBaseUrl(ref)}/${id}/${file}`;

/** The innermost message: `fetch failed` alone says nothing a user can act on. */
const rootCause = (e: unknown): string => {
	let cur: unknown = e;
	for (let i = 0; i < 5 && cur instanceof Error; i++) {
		if (cur.cause === undefined) return cur.message;
		cur = cur.cause;
	}
	return cur instanceof Error ? cur.message : String(cur);
};

/**
 * Fetches pack files from the repository. The second of the two modules allowed
 * to reach a third party — kept alone in its own file so the rule in AGENTS.md
 * stays a short list of named modules rather than a claim nobody can check.
 *
 * Node's own `fetch` follows redirects (raw.githubusercontent.com sends one),
 * and a failure to connect becomes one line naming the URL, not a stack.
 */
export const realPackFetcher: PackFetcher = async (url) => {
	let res: Response;
	try {
		res = await fetch(url, { redirect: 'follow' });
	} catch (e: unknown) {
		throw new Error(`integration-mock: could not download ${url} (${rootCause(e)}) — check your network`);
	}
	const body = await res.text();
	if (res.status === 404) {
		throw new Error(
			`not found: ${url}\n` +
				'The release may not be tagged yet. Pass --ref main to install from the ' +
				'default branch, or --ref <tag> for a specific release.',
		);
	}
	if (res.status >= 400) throw new Error(`${res.status} fetching ${url}`);
	return body;
};
