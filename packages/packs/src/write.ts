import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServicePack } from 'integration-mock-core';

export const GENERATED_ROUTES = '10-generated.json';
export const OVERRIDE_ROUTES = '00-overrides.json';

/**
 * Write a generated pack without disturbing hand-tuned fixes.
 *
 * `loadPack` concatenates `routes/*.json` in filename order and the resolver
 * returns the first match, so `00-overrides.json` shadows `10-generated.json`.
 * Regeneration rewrites only the generated file — spec §6.2 requires hand fixes
 * to survive it, and relying on `main.json` merely happening to sort later would
 * be true today and broken the first time a file was renamed.
 */
export async function saveGeneratedRoutes(dir: string, pack: ServicePack): Promise<void> {
	const { routes, ...meta } = pack;
	const routesDir = join(dir, 'routes');
	await mkdir(routesDir, { recursive: true });
	await writeFile(join(dir, 'pack.json'), JSON.stringify(meta, null, 2) + '\n');
	await writeFile(join(routesDir, GENERATED_ROUTES), JSON.stringify(routes, null, 2) + '\n');
	// Phase 3a wrote routes/main.json; leaving it would serve every route twice.
	await rm(join(routesDir, 'main.json'), { force: true });
}
