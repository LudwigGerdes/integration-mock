import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Assemble the published layout.
 *
 * integration-mock ships as one package, so everything it needs at runtime has to sit
 * inside it. `packs/` goes one level above `dist/` because that is where
 * dataPaths() (packages/packs/src/paths.ts) looks — the same relative position it occupies in the
 * workspace, so pack loading behaves identically either way.
 *
 * Only the core set is bundled. The rest are fetched by `packs install`, which
 * keeps the tarball small without making the common case reach the network.
 */
const CORE = [
	'generic-rest',
	'gmail',
	'google-drive',
	'google-sheets',
	'hubspot',
	'openai',
	'salesforce',
	'slack',
];

const root = new URL('../../', import.meta.url).pathname;
const here = new URL('./', import.meta.url).pathname;

await rm(join(here, 'packs'), { recursive: true, force: true });
await mkdir(join(here, 'packs'), { recursive: true });
for (const id of CORE) {
	await cp(join(root, 'packages/packs/packs', id), join(here, 'packs', id), { recursive: true });
}
await cp(join(root, 'schema'), join(here, 'schema'), { recursive: true });
// `packs build --fetch` reads the vendor URL from here; without it a published
// install could only build from --spec.
await cp(join(root, 'packages/packs/sources.yaml'), join(here, 'sources.yaml'));
// `up` / `down`: the compose pair plus the Dockerfile that builds the mock
// image from this package instead of the workspace.
await rm(join(here, 'docker'), { recursive: true, force: true });
await mkdir(join(here, 'docker'), { recursive: true });
for (const f of ['docker-compose.yml', 'Dockerfile.package']) {
	await cp(join(root, 'docker', f), join(here, 'docker', f));
}
// The pack-authoring agent skill the README links to.
await rm(join(here, 'skills'), { recursive: true, force: true });
await cp(join(root, 'skills'), join(here, 'skills'), { recursive: true });
for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'README.md']) {
	await cp(join(root, f), join(here, f));
}
console.log(
	`prepack: ${CORE.length} core packs, schema, sources.yaml, docker, skills, LICENSE, NOTICE, THIRD_PARTY_NOTICES, README`,
);
