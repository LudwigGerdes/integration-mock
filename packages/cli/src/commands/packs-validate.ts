import type { Command } from 'commander';
import { join } from 'node:path';
import {
	loadLayer,
	mockHome,
	projectPacksDir,
	validatePack,
	type PackProblem,
	type ServicePack,
} from 'integration-mock-core';
import type { CliIo } from '../index.js';

/**
 * The deterministic half of the authoring loop: an agent writes JSON, this says
 * what is wrong in a form it can act on. `--json` exists so the loop iterates on
 * structured problems rather than parsing prose.
 */
export function registerPacksValidate(packs: Command, io: CliIo): void {
	packs
		.command('validate [service]')
		.description('check authored packs for problems')
		.option('--json', 'machine-readable output')
		.action(async (service: string | undefined, o: { json?: boolean }) => {
			const [user, project] = await Promise.all([
				loadLayer(join(mockHome(), 'packs')),
				loadLayer(projectPacksDir()),
			]);
			const all: ServicePack[] = [...user, ...project];
			const targets = service === undefined ? all : all.filter((p) => p.id === service);
			if (targets.length === 0) {
				throw new Error(
					service === undefined
						? 'integration-mock: no user or project packs to validate'
						: `integration-mock: no pack "${service}" in the user or project layer`,
				);
			}

			const rows: Array<PackProblem & { service: string }> = [];
			for (const pack of targets) {
				for (const problem of validatePack(pack, { others: all })) {
					rows.push({ ...problem, service: pack.id });
				}
			}

			if (o.json === true) {
				io.write(JSON.stringify(rows, null, 2));
			} else if (rows.length === 0) {
				io.write(`ok — ${targets.length} pack(s), no problems`);
			} else {
				for (const r of rows) {
					io.write(
						`${r.level === 'error' ? 'ERROR' : 'warn '} ${r.service} ${r.code}: ${r.message}`,
					);
				}
			}

			// Report first, then fail: the report is what the loop acts on, and a
			// non-zero exit is what CI acts on. Both are needed.
			const errors = rows.filter((r) => r.level === 'error').length;
			if (errors > 0) throw new Error(`integration-mock: ${errors} error(s)`);
		});
}
