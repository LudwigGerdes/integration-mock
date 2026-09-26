import { createHash } from 'node:crypto';
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
	version?: string;
	owner?: string;
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
	const winner = new Map<string, { layer: string; version?: string; owner?: string }>();
	// Least specific first: a later layer overwrites the recorded winner.
	for (const [layer, packs] of [
		['library', library],
		['user', user],
		['project', project],
	] as const) {
		for (const p of packs) {
			winner.set(p.id, {
				layer,
				...(p.version === undefined ? {} : { version: p.version }),
				...(p.owner === undefined ? {} : { owner: p.owner }),
			});
		}
	}
	return [...winner]
		.map(([id, w]) => ({ id, ...w, enabled: cfg.enabledPacks.includes(id) }))
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
		.description('list shipped, installed and available packs')
		.option('--installed', 'hide packs that are available but not installed')
		.action(async (o: { installed?: boolean }) => {
			const rows = await listPacks();
			for (const r of rows) {
				// Version and owner trail the three fixed columns, so a script
				// that reads the first three keeps working.
				const meta = [r.version === undefined ? '' : `v${r.version}`, r.owner ?? ''].filter((s) => s !== '');
				io.write(`${r.id}\t${r.layer}\t${r.enabled ? 'enabled' : 'disabled'}${meta.length ? `\t${meta.join(' · ')}` : ''}`);
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
		.option('--no-verify', 'skip the sha256 check against this release\'s index')
		.action(async (ids: string[], o: { ref: string; force?: boolean; verify: boolean }) => {
			// The index carries the hash of every file as this release shipped
			// it. Another ref legitimately differs, so the check is skipped for
			// one — and said so, because "installed" must not read as "verified".
			const releaseRef = `v${CLI_VERSION}`;
			const verify = o.verify && o.ref === releaseRef;
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
					const url = packFileUrl(o.ref, id, file);
					const body = await fetcher(url);
					if (verify) {
						const actual = createHash('sha256').update(body).digest('hex');
						const expected = entry.sha256[file];
						if (expected !== undefined && actual !== expected) {
							await rm(dir, { recursive: true, force: true });
							throw new Error(
								`integration-mock: ${id}/${file} from ${url} does not match this release's index ` +
									`(sha256 ${actual.slice(0, 12)}…, expected ${expected.slice(0, 12)}…); nothing installed. ` +
									'Pass --no-verify only if you trust the source.',
							);
						}
					}
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
				io.write(
					`installed ${id} (${entry.files.length} file(s), ${verify ? 'sha256 verified' : `not verified: ${o.verify ? `--ref ${o.ref}` : '--no-verify'}`}) — integration-mock packs enable ${id}`,
				);
			}
		});

	c.command('enable <ids...>').description('start mocking these services').action(async (ids: string[]) => {
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

	c.command('disable <ids...>').description('stop mocking these services').action(async (ids: string[]) => {
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

	c.command('reset').description('reset stored resources to their seed data').action(async () => {
		await (await adminClient()).resetPacks();
		io.write('stores reset to seed');
	});
}
