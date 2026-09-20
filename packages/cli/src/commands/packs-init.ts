import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mockHome, projectPacksDir, savePack } from 'integration-mock-core';
import type { CliIo } from '../index.js';

/**
 * A valid empty pack, so an agent edits a structure instead of inventing one.
 *
 * Seeded with one real route rather than an empty list: a scaffold that
 * validates but serves nothing teaches the wrong shape, and an empty pack trips
 * the no-error-routes warning for a reason the author did not cause.
 */
export function registerPacksInit(packs: Command, io: CliIo): void {
	packs
		.command('init <service>')
		.description('scaffold a pack to author by hand or with the authoring skill')
		.requiredOption(
			'--domain <host>',
			'vendor hostname this pack stands in for; repeat for several, and `*.` wildcards are honoured',
			(v: string, prev: string[]) => [...prev, v],
			[] as string[],
		)
		.option('--prefix <prefix>', 'base-URL prefix (default: /<service>)')
		.option('--user', 'write to the user layer instead of the project layer')
		.action(async (service: string, o: { domain: string[]; prefix?: string; user?: boolean }) => {
			const root = o.user === true ? join(mockHome(), 'packs') : projectPacksDir();
			const dir = join(root, service);
			if (existsSync(dir)) throw new Error(`integration-mock: ${dir} already exists`);

			await savePack(dir, {
				id: service,
				domains: o.domain,
				prefix: o.prefix ?? `/${service}`,
				source: 'authored',
				routes: [
					{
						id: `${service}:example`,
						match: { method: 'GET', path: '/example' },
						respond: { status: 200, body: { replace: 'me' } },
					},
					{
						id: `${service}:example-not-found`,
						match: { method: 'GET', path: '/example/missing' },
						respond: { status: 404, body: { error: 'not found' } },
					},
				],
			});
			io.write(`created ${dir}`);
			io.write(`next: edit routes/main.json, then \`integration-mock packs validate ${service}\``);
		});
}
