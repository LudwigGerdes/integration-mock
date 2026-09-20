import type { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { Dispatcher } from 'undici';
import { fetchSpec, generatePack, loadSources, parseSpec, sourcesPath } from 'integration-mock-packs';
import type { CliIo } from '../index.js';

export interface AuditRow {
	service: string;
	ok: boolean;
	error?: string;
	bytes: number;
	gzipBytes: number;
	format: 'json' | 'yaml';
	openapi: string;
	operations: number;
	routes: number;
	skipped: number;
	warnings: number;
	license: string;
	sha256: string;
}

let dispatcher: Dispatcher | undefined;
let sourcesFile: string | undefined;
export const setAuditDispatcherForTests = (d: Dispatcher | undefined): void => {
	dispatcher = d;
};
export const setSourcesFileForTests = (f: string | undefined): void => {
	sourcesFile = f;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function countOperations(doc: { paths?: Record<string, Record<string, unknown>> }): number {
	let n = 0;
	for (const item of Object.values(doc.paths ?? {})) {
		for (const m of METHODS) if (item[m] !== undefined) n++;
	}
	return n;
}

const empty = (service: string, license: string): AuditRow => ({
	service,
	ok: false,
	bytes: 0,
	gzipBytes: 0,
	format: 'json',
	openapi: '',
	operations: 0,
	routes: 0,
	skipped: 0,
	warnings: 0,
	license,
	sha256: '',
});

export function registerPacksAudit(packs: Command, io: CliIo): void {
	packs
		.command('audit [services...]')
		.description('fetch every source spec and report whether it is usable (networked)')
		.option('--json', 'emit raw rows')
		.option('--out <file>', 'write the report to a file')
		.action(async (services: string[], o: { json?: boolean; out?: string }) => {
			const sources = await loadSources(sourcesFile ?? sourcesPath());
			const names = services.length ? services : Object.keys(sources).sort();
			const rows: AuditRow[] = [];

			for (const service of names) {
				const src = sources[service];
				if (src === undefined) {
					rows.push({ ...empty(service, 'unknown'), error: 'no sources.yaml entry' });
					continue;
				}
				if (src.url === '') {
					// Distinct from a fetch failure: nobody has looked this vendor up yet.
					rows.push({ ...empty(service, src.license), error: 'no spec url recorded yet' });
					continue;
				}
				try {
					const { bytes, sha256 } = await fetchSpec(src.url, dispatcher);
					const text = bytes.toString('utf8');
					const format = text.trimStart().startsWith('{') ? 'json' : 'yaml';
					const doc = parseSpec(bytes);
					const { report } = generatePack(doc, { id: service });
					rows.push({
						service,
						ok: true,
						bytes: bytes.length,
						gzipBytes: gzipSync(bytes, { level: 9 }).length,
						format,
						openapi: doc.openapi ?? doc.swagger ?? '',
						operations: countOperations(doc),
						routes: report.routes,
						skipped: report.skipped.length,
						warnings: report.warnings.length,
						license: src.license,
						sha256,
					});
				} catch (e: unknown) {
					// One dead URL must not hide the other twenty-nine.
					rows.push({
						...empty(service, src.license),
						error: e instanceof Error ? e.message : String(e),
					});
				}
			}

			const text = o.json
				? JSON.stringify(rows, null, 2)
				: [
						'| service | ok | openapi | ops | routes | skipped | warn | size | gzip | license |',
						'|---|---|---|---|---|---|---|---|---|---|',
						...rows.map(
							(r) =>
								`| ${r.service} | ${r.ok ? 'yes' : 'NO — ' + (r.error ?? '')} | ${r.openapi} | ${r.operations} | ${r.routes} | ${r.skipped} | ${r.warnings} | ${Math.round(r.bytes / 1024)}k | ${Math.round(r.gzipBytes / 1024)}k | ${r.license} |`,
						),
					].join('\n');

			if (o.out !== undefined) await writeFile(o.out, text + '\n');
			io.write(text);
		});
}
