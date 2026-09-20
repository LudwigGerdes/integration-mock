import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { mockHome } from './config.js';
import type { Route, ServicePack } from './types.js';

/** Personal overrides: `~/.integration-mock/packs`. */
export const USER_PACKS_DIR = join(mockHome(), 'packs');

/** Project overrides, checked in beside the workflows. Resolved per call so tests can chdir. */
export const projectPacksDir = (cwd = process.cwd()): string =>
	resolvePath(cwd, '.integration-mock', 'packs');

/** @deprecated prefer {@link projectPacksDir} — this is captured at import time. */
export const PROJECT_PACKS_DIR = projectPacksDir();

const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

function assertPackMeta(v: unknown, dir: string): asserts v is Omit<ServicePack, 'routes'> {
	const o = v as Record<string, unknown> | null;
	const ok =
		o &&
		typeof o.id === 'string' &&
		Array.isArray(o.domains) &&
		typeof o.prefix === 'string' &&
		typeof o.source === 'string';
	if (!ok) throw new Error(`invalid pack.json in ${dir}`);
}

/**
 * Load one pack directory.
 *
 * Layout: `pack.json` holds the metadata, `routes/*.json` each hold a `Route[]`;
 * route files are merged in filename order so generated and hand-tuned routes
 * can live side by side.
 */
export async function loadPack(dir: string): Promise<ServicePack> {
	const metaPath = join(dir, 'pack.json');
	if (!(await exists(metaPath))) throw new Error(`invalid pack: missing ${metaPath}`);

	const meta: unknown = JSON.parse(await readFile(metaPath, 'utf8'));
	assertPackMeta(meta, dir);

	const routesDir = join(dir, 'routes');
	let routes: Route[] = [];
	if (await exists(routesDir)) {
		const files = (await readdir(routesDir)).filter((f) => f.endsWith('.json')).sort();
		for (const f of files) {
			routes = routes.concat(JSON.parse(await readFile(join(routesDir, f), 'utf8')) as Route[]);
		}
	}
	return { ...meta, routes };
}

export async function savePack(dir: string, pack: ServicePack): Promise<void> {
	const { routes, ...meta } = pack;
	await mkdir(join(dir, 'routes'), { recursive: true });
	await writeFile(join(dir, 'pack.json'), JSON.stringify(meta, null, 2) + '\n');
	await writeFile(join(dir, 'routes', 'main.json'), JSON.stringify(routes, null, 2) + '\n');
}

/** Load every pack directory in a layer root; a missing root is not an error. */
export async function loadLayer(dir: string): Promise<ServicePack[]> {
	if (!(await exists(dir))) return [];
	const out: ServicePack[] = [];
	for (const name of await readdir(dir)) {
		const sub = join(dir, name);
		try {
			if ((await stat(sub)).isDirectory() && (await exists(join(sub, 'pack.json')))) {
				out.push(await loadPack(sub));
			}
		} catch (e) {
			// An entry can vanish between readdir and stat — a pack removed or
			// swapped while the daemon is scanning. Skip it rather than failing
			// the whole layer; the next scan sees the settled state.
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		}
	}
	return out;
}
