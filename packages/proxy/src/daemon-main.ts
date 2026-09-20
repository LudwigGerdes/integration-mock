import { runDaemon } from './daemon.js';

/**
 * The process entry point: `node packages/proxy/dist/daemon-main.js` (the
 * Docker image). Kept apart from `daemon.ts` so importing `runDaemon` never
 * starts one as a side effect — the published CLI bundles its own entry
 * (`packages/cli/src/daemon.ts`) around the same function.
 */
runDaemon().catch((e: unknown) => {
	console.error(e);
	process.exit(1);
});
