import { Agent, interceptors, request, type Dispatcher } from 'undici';
import { sha256 } from './spec-io.js';

/**
 * Spec hosts redirect (apis.guru, raw.githubusercontent.com). Redirects are
 * followed by an interceptor on our own agent: the `maxRedirections` request
 * option is refused once the process-wide dispatcher is a newer undici than
 * the one this package imports, which is exactly the case under Node 24.
 */
let following: Dispatcher | undefined;
const followingRedirects = (): Dispatcher =>
	(following ??= new Agent().compose(interceptors.redirect({ maxRedirections: 3 })));

/**
 * The only network call in this repository.
 *
 * Reached solely from `packs build --fetch` and `packs update`; every other path
 * reads a vendored spec from disk, so the tool works with no connectivity. Keep
 * it that way — this module staying tiny and alone is what makes "can this thing
 * phone home?" a one-file question.
 */
export async function fetchSpec(
	url: string,
	dispatcher: Dispatcher = followingRedirects(),
): Promise<{ bytes: Buffer; sha256: string }> {
	const res = await request(url, { method: 'GET', dispatcher });
	if (res.statusCode < 200 || res.statusCode >= 300) {
		throw new Error(`spec fetch ${url} → ${res.statusCode}`);
	}
	const bytes = Buffer.from(await res.body.arrayBuffer());
	return { bytes, sha256: sha256(bytes) };
}
