import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Where the files integration-mock reads at runtime live, and why. */
export interface DataPaths {
	layout: 'override' | 'workspace' | 'package';
	/** The shipped pack library. */
	packsDir: string;
	/** Vendor spec sources, read by `packs build --fetch` / `packs update`. */
	sourcesFile: string;
	/** The n8n + mock pair behind `up` / `down`. */
	composeFile: string;
	/** Agent skills shipped for pack authoring. */
	skillsDir: string;
}

/**
 * The ONE place that decides where runtime data lives. Decided by what is on
 * disk around the running code, never by a workspace package name, because the
 * same code runs from three layouts:
 *
 * - `INTEGRATION_MOCK_DATA_DIR` set: that directory holds `packs/`,
 *   `sources.yaml`, `docker/` and `skills/`. The owner's escape hatch.
 * - A checkout: the code runs from `packages/<pkg>/dist/` (or `src/` under
 *   vitest). `packages/packs/` is the source of truth that `packs build` writes
 *   to and the daemon serves; `docker/` and `skills/` sit at the repo root.
 *   "One level up" from the CLI bundle would be the prepack copy — absent in a
 *   fresh clone, stale after one — so the workspace wins when present. It is
 *   recognised by `packages/packs/sources.yaml` AND `pnpm-workspace.yaml` two
 *   levels further up, so an unrelated `node_modules/packs/` cannot pose as it.
 * - The published tarball: the package root, one level above `dist/`, which
 *   prepack assembles with the same relative names.
 *
 * `from` is the directory of the running module; every bundle entry point and
 * chunk is emitted flat into `dist/`, so it is the same for all of them.
 */
export const resolveDataPaths = (
	from: string,
	env: Record<string, string | undefined>,
	exists: (p: string) => boolean = existsSync,
): DataPaths => {
	const at = (layout: DataPaths['layout'], packsRoot: string, extrasRoot: string): DataPaths => ({
		layout,
		packsDir: join(packsRoot, 'packs'),
		sourcesFile: join(packsRoot, 'sources.yaml'),
		composeFile: join(extrasRoot, 'docker', 'docker-compose.yml'),
		skillsDir: join(extrasRoot, 'skills'),
	});

	const override = env.INTEGRATION_MOCK_DATA_DIR;
	if (override) return at('override', resolve(override), resolve(override));

	const workspacePacks = join(from, '..', '..', 'packs');
	const repoRoot = join(from, '..', '..', '..');
	if (exists(join(workspacePacks, 'sources.yaml')) && exists(join(repoRoot, 'pnpm-workspace.yaml'))) {
		return at('workspace', workspacePacks, repoRoot);
	}

	const packageRoot = join(from, '..');
	return at('package', packageRoot, packageRoot);
};

/** {@link resolveDataPaths} for the running process. Read per call so the env override is honoured. */
export const dataPaths = (): DataPaths => resolveDataPaths(here, process.env);
