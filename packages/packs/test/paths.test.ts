import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataPaths, resolveDataPaths } from '../src/paths.js';

const touch = (file: string): void => {
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, '');
};

describe('resolveDataPaths', () => {
	it('workspace checkout: packs from packages/packs, docker and skills from the repo root', () => {
		const repo = mkdtempSync(join(tmpdir(), 'im-paths-ws-'));
		touch(join(repo, 'pnpm-workspace.yaml'));
		touch(join(repo, 'packages/packs/sources.yaml'));
		// The prepack copy beside the bundle must NOT win over the source of truth.
		touch(join(repo, 'packages/cli/sources.yaml'));

		const p = resolveDataPaths(join(repo, 'packages/cli/dist'), {});
		expect(p.layout).toBe('workspace');
		expect(p.packsDir).toBe(join(repo, 'packages/packs/packs'));
		expect(p.sourcesFile).toBe(join(repo, 'packages/packs/sources.yaml'));
		expect(p.composeFile).toBe(join(repo, 'docker/docker-compose.yml'));
		expect(p.skillsDir).toBe(join(repo, 'skills'));
	});

	it('packed tarball: everything under the package root, one level above dist/', () => {
		const app = mkdtempSync(join(tmpdir(), 'im-paths-pkg-'));
		const pkg = join(app, 'node_modules/integration-mock');
		touch(join(pkg, 'sources.yaml'));

		const p = resolveDataPaths(join(pkg, 'dist'), {});
		expect(p.layout).toBe('package');
		expect(p.packsDir).toBe(join(pkg, 'packs'));
		expect(p.sourcesFile).toBe(join(pkg, 'sources.yaml'));
		expect(p.composeFile).toBe(join(pkg, 'docker/docker-compose.yml'));
		expect(p.skillsDir).toBe(join(pkg, 'skills'));
	});

	it('is not fooled by an unrelated node_modules/packs/sources.yaml beside an install', () => {
		const app = mkdtempSync(join(tmpdir(), 'im-paths-decoy-'));
		const pkg = join(app, 'node_modules/integration-mock');
		touch(join(pkg, 'sources.yaml'));
		touch(join(app, 'node_modules/packs/sources.yaml'));

		expect(resolveDataPaths(join(pkg, 'dist'), {}).layout).toBe('package');
	});

	it('INTEGRATION_MOCK_DATA_DIR overrides both layouts', () => {
		const repo = mkdtempSync(join(tmpdir(), 'im-paths-env-'));
		touch(join(repo, 'pnpm-workspace.yaml'));
		touch(join(repo, 'packages/packs/sources.yaml'));

		const p = resolveDataPaths(join(repo, 'packages/cli/dist'), { INTEGRATION_MOCK_DATA_DIR: '/srv/im-data' });
		expect(p.layout).toBe('override');
		expect(p.packsDir).toBe('/srv/im-data/packs');
		expect(p.sourcesFile).toBe('/srv/im-data/sources.yaml');
		expect(p.composeFile).toBe('/srv/im-data/docker/docker-compose.yml');
	});
});

describe('dataPaths', () => {
	it('resolves to the workspace when run from this checkout', () => {
		const p = dataPaths();
		expect(p.layout).toBe('workspace');
		expect(p.packsDir).toMatch(/packages\/packs\/packs$/);
	});
});
