import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Remove what prepack copied into the package dir, so a checkout is clean
 * after `pnpm pack` and the bundle keeps resolving the workspace's own data
 * (a stale copy here would otherwise sit closer to dist/ than the real one).
 * Every name is a gitignored copy; nothing tracked is touched.
 */
const here = new URL('./', import.meta.url).pathname;
for (const f of [
	'packs',
	'schema',
	'docker',
	'skills',
	'sources.yaml',
	'LICENSE',
	'NOTICE',
	'THIRD_PARTY_NOTICES.md',
	'README.md',
]) {
	await rm(join(here, f), { recursive: true, force: true });
}
