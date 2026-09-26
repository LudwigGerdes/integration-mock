import { writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
	RequestLog,
	FaultController,
	loadGlobalConfig,
	loadProjectConfig,
	loadLayer,
	mockHome,
	projectPacksDir,
	type ServicePack,
} from 'integration-mock-core';
import { loadLibraryLayer } from 'integration-mock-packs';
import { ensureCA } from './ca.js';
import { MockEngine } from './state.js';
import { startProxy } from './server.js';

/**
 * The two layers a user writes to while the daemon runs. `mockHome()` is read
 * per call so INTEGRATION_MOCK_HOME set by the launcher is honoured.
 */
const diskLayers = async (): Promise<{ user: ServicePack[]; project: ServicePack[] }> => {
	const [user, project] = await Promise.all([
		loadLayer(join(mockHome(), 'packs')),
		loadLayer(projectPacksDir()),
	]);
	return { user, project };
};

/** Long-running proxy process behind `integration-mock start`. */
export async function runDaemon(): Promise<void> {
	await loadGlobalConfig();
	const project = await loadProjectConfig();
	const ca = await ensureCA();

	const [{ user, project: proj }, library] = await Promise.all([diskLayers(), loadLibraryLayer()]);

	const engine = new MockEngine({
		packs: { library, user, project: proj, snapshot: [] },
		log: new RequestLog({ file: join(mockHome(), 'requests.jsonl'), redactPaths: project.redact }),
		faults: new FaultController(),
		enabledPacks: project.enabledPacks,
		redactPaths: project.redact,
		// The CLI that spawned us says which release it is; the daemon has no
		// manifest of its own to read.
		...(process.env.INTEGRATION_MOCK_VERSION === undefined ? {} : { version: process.env.INTEGRATION_MOCK_VERSION }),
	});

	// Loopback keeps the zero-config local path; any reachable bind gets a token.
	const adminBind =
		process.env.INTEGRATION_MOCK_ADMIN_BIND ?? '127.0.0.1';
	const adminLoopback =
		adminBind === '127.0.0.1' || adminBind === '::1' || adminBind === 'localhost';
	const adminToken = adminLoopback ? undefined : randomUUID();

	const srv = await startProxy({
		engine,
		ca,
		adminToken,
		reloadPacks: async () => engine.replaceLayers(await diskLayers()),
		port: Number(process.env.INTEGRATION_MOCK_PORT ?? 8080),
		adminPort: Number(process.env.INTEGRATION_MOCK_ADMIN_PORT ?? 8081),
	});

	const info = join(mockHome(), 'proxy.json');
	await writeFile(
		info,
		JSON.stringify({
			port: srv.port,
			adminPort: srv.adminPort,
			pid: process.pid,
			token: adminToken,
		}),
	);

	const stop = (): void => {
		void (async () => {
			await srv.close();
			await rm(info, { force: true });
			process.exit(0);
		})();
	};
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}
