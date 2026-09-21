import type { Command } from 'commander';
import { loadLibraryLayer } from 'integration-mock-packs';
import {
	loadLayer,
	loadProjectConfig,
	saveProjectConfig,
	projectPacksDir,
	mockHome,
} from 'integration-mock-core';
import { join } from 'node:path';
import type { CliIo } from '../index.js';
import { adminClient, syncPacksWithProxy } from './proxy.js';
import { registerPacksAudit } from './packs-audit.js';
import { registerPacksBuild } from './packs-build.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadPack, validatePack } from 'integration-mock-core';
import { PACK_INDEX } from '../pack-index.js';
import { CLI_VERSION } from '../version.js';
import { packFileUrl, realPackFetcher, type PackFetcher } from './packs-fetch.js';
import { registerPacksInit } from './packs-init.js';
import { registerPacksValidate } from './packs-validate.js';

export interface PackRow {
	id: string;
	layer: string;
	enabled: boolean;
}

/**
 * All three resolvable layers, most specific last so the row a user sees matches
 * the layer the resolver would pick. The library layer ships with integration-mock-packs;
 * an id present in several layers is reported once, at its winning layer.
 */
export async function listPacks(): Promise<PackRow[]> {
	const [library, user, project, cfg] = await Promise.all([
		loadLibraryLayer(),
		loadLayer(join(mockHome(), 'packs')),
		loadLayer(projectPacksDir()),
		loadProjectConfig(),
	]);
	const winner = new Map<string, string>();
	// Least specific first: a later layer overwrites the recorded winner.
	for (const [layer, packs] of [
		['library', library],
		['user', user],
		['project', project],
	] as const) {
		for (const p of packs) winner.set(p.id, layer);
	}
	return [...winner]
		.map(([id, layer]) => ({ id, layer, enabled: cfg.enabledPacks.includes(id) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function registerPacks(
	p: Command,
	io: CliIo,
	fetcher: PackFetcher = realPackFetcher,
): void {
	const c = p.command('packs').description('service packs');

	// Offline by design: installed packs come from disk, and everything else
	// from the index compiled into this binary. Only `install` needs a network.
	c.command('list')
		.option('--installed', 'hide packs that are available but not installed')
		.action(async (o: { installed?: boolean }) => {
			const rows = await listPacks();
			for (const r of rows) {
				io.write(`${r.id}\t${r.layer}\t${r.enabled ? 'enabled' : 'disabled'}`);
			}
			if (o.installed === true) return;
			const have = new Set(rows.map((r) => r.id));
			for (const id of Object.keys(PACK_INDEX).sort()) {
				if (have.has(id)) continue;
				const kb = Math.max(1, Math.round(PACK_INDEX[id]!.bytes / 1024));
				io.write(`${id}\tavailable\t${kb}KB — integration-mock packs install ${id}`);
			}
		});

	c.command('install <ids...>')
		.description('download packs this release did not ship with')
		.option('--ref <ref>', 'git ref to install from', `v${CLI_VERSION}`)
		.option('--force', 'overwrite an already-installed pack')
		.action(async (ids: string[], o: { ref: string; force?: boolean }) => {
			for (const id of ids) {
				const entry = PACK_INDEX[id];
				if (entry === undefined) {
					throw new Error(`integration-mock: no pack "${id}" in this release's index`);
				}
				const dir = join(mockHome(), 'packs', id);
				if (existsSync(dir) && o.force !== true) {
					io.write(`${id}: already installed — pass --force to replace`);
					continue;
				}

				for (const file of entry.files) {
					const body = await fetcher(packFileUrl(o.ref, id, file));
					const target = join(dir, file);
					await mkdir(dirname(target), { recursive: true });
					await writeFile(target, body);
				}

				// Validate what arrived rather than trusting it: a partial or
				// truncated download that still parses would otherwise sit there
				// serving wrong answers.
				const problems = validatePack(await loadPack(dir)).filter(
					(x) => x.level === 'error',
				);
				if (problems.length > 0) {
					await rm(dir, { recursive: true, force: true });
					throw new Error(
						`integration-mock: ${id} downloaded but failed validation (${problems[0]!.message}); removed`,
					);
				}
				io.write(`installed ${id} (${entry.files.length} file(s)) — integration-mock packs enable ${id}`);
			}
		});

	c.command('enable <ids...>').action(async (ids: string[]) => {
		// Refuse before saving: an id no layer holds would be reported as
		// enabled and then serve nothing.
		const have = new Set((await listPacks()).map((r) => r.id));
		for (const id of ids) {
			if (have.has(id)) continue;
			throw new Error(
				PACK_INDEX[id] !== undefined
					? `integration-mock: pack "${id}" is not installed — run \`integration-mock packs install ${id}\` first`
					: `integration-mock: no pack "${id}" — \`integration-mock packs list\` shows what is installed and available`,
			);
		}
		const cfg = await loadProjectConfig();
		cfg.enabledPacks = [...new Set([...cfg.enabledPacks, ...ids])];
		await saveProjectConfig(cfg);
		const live = await syncPacksWithProxy();
		io.write(`enabled: ${ids.join(', ')}${live ? '' : ' (saved; takes effect on `integration-mock start`)'}`);
	});

	c.command('disable <ids...>').action(async (ids: string[]) => {
		const cfg = await loadProjectConfig();
		cfg.enabledPacks = cfg.enabledPacks.filter((x) => !ids.includes(x));
		await saveProjectConfig(cfg);
		const live = await syncPacksWithProxy();
		io.write(`disabled: ${ids.join(', ')}${live ? '' : ' (saved; takes effect on `integration-mock start`)'}`);
	});

	registerPacksBuild(c, io);
	registerPacksAudit(c, io);
	registerPacksInit(c, io);
	registerPacksValidate(c, io);

	c.command('reset').action(async () => {
		await (await adminClient()).resetPacks();
		io.write('stores reset to seed');
	});
}
