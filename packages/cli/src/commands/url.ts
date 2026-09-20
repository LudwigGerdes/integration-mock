import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockHome } from 'integration-mock-core';
import { adminClient } from './proxy.js';
import type { CliIo } from '../index.js';

/**
 * Base-URL mode is only usable if the user knows the URL.
 *
 * Both halves come from the running proxy rather than from assumption: the port
 * from proxy.json (the daemon may not be on 8080) and the prefix from the admin
 * API (a pack's prefix need not be '/' + its id).
 */
export function registerUrl(program: Command, io: CliIo): void {
	program
		.command('url [service]')
		.description('print the base URL to point a workflow at')
		.action(async (service?: string) => {
			const state = await (await adminClient()).getState();
			const { port } = JSON.parse(await readFile(join(mockHome(), 'proxy.json'), 'utf8')) as {
				port: number;
			};

			// A daemon started before packPrefixes existed returns undefined here.
			// Say so, rather than throwing a TypeError the user cannot act on.
			const prefixes = state.packPrefixes;
			if (prefixes === undefined) {
				throw new Error(
					'integration-mock: the running proxy predates this CLI — restart it with `integration-mock stop && integration-mock start`',
				);
			}
			if (service !== undefined) {
				const prefix = prefixes[service];
				if (prefix === undefined) {
					throw new Error(`integration-mock: pack "${service}" is not enabled`);
				}
				io.write(`http://127.0.0.1:${port}${prefix}`);
				return;
			}

			const ids = Object.keys(prefixes).sort();
			if (ids.length === 0) {
				io.write('no packs enabled — run `integration-mock packs enable <service>`');
				return;
			}
			for (const id of ids) io.write(`http://127.0.0.1:${port}${prefixes[id]}`);
		});
}
