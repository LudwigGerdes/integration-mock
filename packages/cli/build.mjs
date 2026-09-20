import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

/**
 * integration-mock publishes as ONE package, so the workspace libraries are compile-time
 * inputs rather than runtime dependencies: integration-mock-core, -proxy and -packs are
 * bundled in, and everything third-party stays external so npm can dedupe and
 * patch it normally.
 *
 * Two entry points, because anything loaded at runtime BY PATH needs a file of
 * its own inside the package:
 *   dist/bin.js     the CLI
 *   dist/daemon.js  the long-running proxy that `start` spawns, found with
 *                   `new URL('./daemon.js', import.meta.url)`
 * `splitting` keeps the code they share in one chunk instead of two copies.
 *
 * Everything is emitted FLAT into dist/, one level below the package root:
 * that depth is what `dataPaths()` (packages/packs/src/paths.ts) and
 * `daemonEntry()` rely on, for entry points and chunks alike.
 */
const external = ['ajv', 'commander', 'nanoid', 'node-forge', 'picomatch', 'undici', 'yaml'];

// Wipe first: stale chunks from an earlier build would ship otherwise.
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });

await build({
	entryPoints: { bin: 'src/bin.ts', daemon: 'src/daemon.ts' },
	outdir: 'dist',
	entryNames: '[name]',
	chunkNames: 'chunk-[hash]',
	bundle: true,
	splitting: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	sourcemap: true,
	external: [...external, ...external.map((e) => `${e}/*`)],
	logLevel: 'warning',
});
