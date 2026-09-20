import type { Command } from 'commander';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { projectPacksDir } from 'integration-mock-core';
import {
	fetchSpec,
	generatePack,
	libraryPacksDir,
	loadSources,
	parseSpec,
	readVendoredSpec,
	mergePacks,
	saveGeneratedRoutes,
	specVersionOf,
	saveSources,
	writeVendoredSpec,
	type BuildReport,
} from 'integration-mock-packs';
import type { CliIo } from '../index.js';
import { syncPacksWithProxy } from './proxy.js';

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

/** Precedence: explicit file, then an opted-in fetch, then the vendored copy. */
async function specFor(service: string, o: { spec?: string; fetch?: boolean }): Promise<Buffer> {
	if (o.spec !== undefined) return readFile(o.spec);

	if (o.fetch === true) {
		const sources = await loadSources();
		const src = sources[service];
		if (src === undefined) throw new Error(`no sources.yaml entry for ${service}`);
		const { bytes, sha256: digest } = await fetchSpec(src.url);
		const specVersion = specVersionOf(parseSpec(bytes));
		if (src.vendored) await writeVendoredSpec(service, specVersion, bytes);
		await saveSources({ ...sources, [service]: { ...src, sha256: digest, specVersion } });
		return bytes;
	}

	const sources = await loadSources();
	const vendored = await readVendoredSpec(service, sources[service]?.specVersion);
	if (vendored !== null) return vendored;
	// Nothing cached. Only `acme` is vendored in the repository; every other
	// vendor's spec is downloaded on demand, so say which command does that.
	if (sources[service] !== undefined) {
		throw new Error(
			`no spec for ${service} cached locally — run \`integration-mock packs build ${service} --fetch\` ` +
				`to download it from sources.yaml, or pass --spec <file>`,
		);
	}
	throw new Error(
		`no spec for ${service} — pass --spec <file>, or add a sources.yaml entry and use --fetch`,
	);
}

function printReport(io: CliIo, report: BuildReport): void {
	io.write(`service\t${report.service}`);
	io.write(`routes\t${report.routes}`);
	for (const s of report.skipped) io.write(`  skipped  ${s.method} ${s.path} — ${s.reason}`);
	for (const w of report.warnings) io.write(`  ⚠ ${w}`);
}

export function registerPacksBuild(packs: Command, io: CliIo): void {
	packs
		.command('build <service>')
		.description('generate a pack from an OpenAPI spec')
		.option('--spec <file>', 'build from a local spec file')
		.option('--fetch', 'download the spec named in sources.yaml (the only networked path)')
		.option('--domains <list>', 'comma-separated host overrides')
		.action(async (service: string, o: { spec?: string; fetch?: boolean; domains?: string }) => {
			const sources = await loadSources();
			const multi = sources[service]?.urls;
			if (multi !== undefined && multi.length > 0 && o.spec === undefined) {
				const parts = [];
				const combined: BuildReport = { service, routes: 0, skipped: [], warnings: [] };
				for (const url of multi) {
					const { bytes } = await fetchSpec(url);
					const r = generatePack(parseSpec(bytes), { id: service });
					parts.push(r.pack);
					combined.routes += r.report.routes;
					combined.skipped.push(...r.report.skipped);
					combined.warnings.push(...r.report.warnings);
				}
				const { pack: merged, duplicates } = mergePacks(service, parts);
				combined.routes = merged.routes.length;
				if (duplicates > 0) {
					combined.warnings.push(`${duplicates} duplicate method+path routes dropped while merging ${multi.length} specs`);
				}
				await saveGeneratedRoutes(join(libraryPacksDir(), service), merged);
				printReport(io, combined);
				return;
			}

			const bytes = await specFor(service, o);
			const { pack, report } = generatePack(parseSpec(bytes), {
				id: service,
				...(o.domains !== undefined
					? { domains: o.domains.split(',').map((d) => d.trim()) }
					: {}),
			});
			await saveGeneratedRoutes(join(libraryPacksDir(), service), pack);
			printReport(io, report);
		});

	packs
		.command('update [services...]')
		.description('refresh vendored specs from sources.yaml and rebuild what changed')
		.action(async (services: string[]) => {
			const sources = await loadSources();
			const names = services.length
				? services
				: Object.keys(sources).filter((k) => sources[k]!.vendored);
			for (const name of names) {
				const src = sources[name];
				if (src === undefined) {
					io.write(`${name}\t(no sources.yaml entry)`);
					continue;
				}
				const { bytes, sha256: digest } = await fetchSpec(src.url);
				const changed = src.sha256 !== digest;
				io.write(
					`${name}\t${(src.sha256 ?? 'none').slice(0, 12)} → ${digest.slice(0, 12)}\t${changed ? 'changed' : 'unchanged'}`,
				);
				if (!changed) continue;
				const doc = parseSpec(bytes);
				const specVersion = specVersionOf(doc);
				if (src.vendored) await writeVendoredSpec(name, specVersion, bytes);
				await saveSources({
					...(await loadSources()),
					[name]: { ...src, sha256: digest, specVersion },
				});
				const { pack, report } = generatePack(doc, { id: name });
				await saveGeneratedRoutes(join(libraryPacksDir(), name), pack);
				printReport(io, report);
			}
		});

	packs
		.command('eject <service>')
		.description('copy a library pack into ./.integration-mock/packs so it can be edited')
		.option('--force', 'overwrite an existing project pack')
		.action(async (service: string, o: { force?: boolean }) => {
			const from = join(libraryPacksDir(), service);
			if (!(await exists(join(from, 'pack.json')))) throw new Error(`no library pack ${service}`);
			const to = join(projectPacksDir(), service);
			if ((await exists(to)) && o.force !== true) {
				throw new Error(`${to} already exists — pass --force to overwrite`);
			}
			await mkdir(to, { recursive: true });
			await cp(from, to, { recursive: true });
			// The project copy now shadows the library one; a running daemon
			// must re-read its layers or keep serving the original.
			await syncPacksWithProxy();
			io.write(`ejected ${service} → ${to}`);
		});
}
