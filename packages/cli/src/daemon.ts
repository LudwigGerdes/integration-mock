import { runDaemon } from 'integration-mock-proxy/daemon';

/**
 * The daemon as its own entry point of the published bundle (`dist/daemon.js`).
 *
 * `integration-mock start` spawns this file, found relative to the bundled CLI
 * — never through a workspace package name, which does not exist once the
 * package is installed from npm. Ports and home arrive through the environment.
 */
runDaemon().catch((e: unknown) => {
	console.error(e);
	process.exit(1);
});
