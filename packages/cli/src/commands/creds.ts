import type { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	loadGlobalConfig,
	loadLayer,
	mockHome,
	projectPacksDir,
	swapWorkflowUrls,
	synthesizeCredential,
} from 'integration-mock-core';
import { loadLibraryLayer } from 'integration-mock-packs';
import { realCredsClient, type CredsClient } from './creds-fetch.js';
import type { CliIo } from '../index.js';

export type CredsClientFactory = (baseUrl: string, apiKey: string) => CredsClient;

/**
 * Provision a dummy credential so n8n will run the workflow at all.
 *
 * n8n refuses a workflow whose credential id does not resolve, before any HTTP
 * call is attempted — so the mock never sees the request. This is the wall that
 * stops a workflow lifted from another environment, and it is the reason a
 * mock alone is not enough.
 *
 * The values authenticate nothing. The mock does not check them, and the point
 * is only to make the record exist.
 */
export function registerCreds(
	program: Command,
	io: CliIo,
	factory: CredsClientFactory = realCredsClient,
): void {
	const creds = program.command('creds').description('mock credentials on an n8n instance');

	creds
		.command('push <type>')
		.description('create a dummy credential of this type, shaped by n8n’s own schema')
		.option('--name <name>', 'credential name as it appears in n8n')
		.option('--field <kv>', 'set a field, "key=value"; repeatable',
			(v: string, prev: string[]) => [...prev, v], [] as string[])
		.option('--instance <name>', 'which configured instance (default: the default one)')
		.option('--dry-run', 'print what would be created, and create nothing')
		.option('--json', 'machine-readable output')
		.action(async (type: string, o: {
			name?: string; field: string[]; instance?: string; dryRun?: boolean; json?: boolean;
		}) => {
			const cfg = await loadGlobalConfig();
			const all = cfg.instances ?? [];
			const inst =
				o.instance !== undefined
					? all.find((i) => i.name === o.instance)
					: (all.find((i) => i.name === cfg.defaultInstance) ?? all[0]);
			if (inst === undefined) {
				throw new Error(
					o.instance !== undefined
						? `integration-mock: no instance "${o.instance}" — add one with \`integration-mock instances add\``
						: 'integration-mock: no instance configured — add one with `integration-mock instances add`',
				);
			}

			const overrides: Record<string, string> = {};
			for (const f of o.field) {
				const i = f.indexOf('=');
				if (i > 0) overrides[f.slice(0, i)] = f.slice(i + 1);
			}

			const client = factory(inst.url, inst.apiKey);
			const schema = await client.schema(type);
			const data = synthesizeCredential(schema, overrides);
			const name = o.name ?? `${type} (mock)`;

			if (o.dryRun === true) {
				const preview = { name, type, data, instance: inst.name };
				io.write(o.json === true ? JSON.stringify(preview, null, 2) : `would create "${name}" (${type}) on ${inst.name}`);
				if (o.json !== true) for (const k of Object.keys(data)) io.write(`  ${k} = ${String(data[k])}`);
				return;
			}

			const created = await client.create({ name, type, data });
			io.write(
				o.json === true
					? JSON.stringify({ ...created, type, instance: inst.name }, null, 2)
					: `created "${created.name}" (${type}) on ${inst.name} — id ${created.id}`,
			);
		});

	creds
		.command('swap <file>')
		.description("re-point a workflow's URLs at the mock, or back at the vendor")
		.option('--mock', 'point at the mock (default)')
		.option('--real', 'point back at the real vendors')
		.option('--base-url <url>', 'the mock base URL (default: the running proxy)')
		.option(
			'--via <how>',
			'"url" rewrites each URL (default); "proxy" sets the node\'s own Proxy option instead — the only way to intercept on n8n Cloud, and HTTP Request nodes only',
			'url',
		)
		.option('--out <file>', 'write the result here')
		.option('--in-place', 'overwrite the input file')
		.option('--json', 'machine-readable changes')
		.action(async (file: string, o: {
			mock?: boolean; real?: boolean; baseUrl?: string; via?: string;
			out?: string; inPlace?: boolean; json?: boolean;
		}) => {
			if (o.mock === true && o.real === true) {
				throw new Error('integration-mock: choose --mock or --real, not both');
			}
			const direction = o.real === true ? 'real' : 'mock';
			if (o.via !== 'url' && o.via !== 'proxy') {
				throw new Error(`integration-mock: --via must be "url" or "proxy", not "${String(o.via)}"`);
			}
			const via = o.via;

			let baseUrl = o.baseUrl;
			if (baseUrl === undefined) {
				try {
					const info = JSON.parse(
						await readFile(join(mockHome(), 'proxy.json'), 'utf8'),
					) as { port: number };
					baseUrl = `http://127.0.0.1:${info.port}`;
				} catch {
					throw new Error('integration-mock: no proxy running — pass --base-url');
				}
			}

			// Every installed pack, not only the enabled ones: whether a pack is
			// currently serving is a runtime question, and rewriting a file is not.
			const [library, user, project] = await Promise.all([
				loadLibraryLayer(),
				loadLayer(join(mockHome(), 'packs')),
				loadLayer(projectPacksDir()),
			]);
			const packs = [...project, ...user, ...library];

			const workflow = JSON.parse(await readFile(file, 'utf8')) as unknown;
			const result = swapWorkflowUrls(workflow, packs, { direction, baseUrl, via });

			if (o.json === true) {
				io.write(JSON.stringify({ changes: result.changes, skipped: result.skipped }, null, 2));
			} else {
				for (const c of result.changes) io.write(`${c.node}: ${c.from} -> ${c.to}`);
				for (const s2 of result.skipped) io.write(`skipped ${s2.node}: ${s2.reason}`);
				if (result.changes.length === 0) io.write('no URLs to swap');
			}

			const target = o.inPlace === true ? file : o.out;
			if (target !== undefined) {
				await writeFile(target, JSON.stringify(result.workflow, null, 2) + '\n');
				io.write(`wrote ${target}`);
			} else if (result.changes.length > 0) {
				io.write('(preview only — pass --out <file> or --in-place to write)');
			}
		});
}
