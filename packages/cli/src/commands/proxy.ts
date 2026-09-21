import type { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig, mockHome, type FaultSpec, type LogEntry } from 'integration-mock-core';
import { dataPaths } from 'integration-mock-packs';
import { AdminClient, ensureCA } from 'integration-mock-proxy';
import type { CliIo } from '../index.js';

export interface ProxyInfo {
	port: number;
	adminPort: number;
	pid: number;
	/** Present only when the daemon's admin API binds off-loopback. */
	token?: string;
}


/** Is anything already listening on this port? */
const portInUse = (port: number, host = '127.0.0.1'): Promise<boolean> =>
	new Promise((resolve) => {
		const sock = netConnect({ port, host });
		const done = (inUse: boolean): void => {
			sock.destroy();
			resolve(inUse);
		};
		sock.setTimeout(700);
		sock.once('connect', () => done(true));
		sock.once('timeout', () => done(false));
		sock.once('error', () => done(false));
	});

/** Poll a predicate until it holds or the deadline passes. */
async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await check()) return true;
		if (Date.now() > deadline) return false;
		await new Promise((r) => setTimeout(r, 1000));
	}
}

const infoPath = (): string => join(mockHome(), 'proxy.json');

/**
 * What the host CLI needs in order to talk to the pair. Inside the pair the
 * admin API binds 0.0.0.0, so it requires the bearer token the daemon mints into
 * the container's volume; without it every later verb answers 401. The ports are
 * the published ones, not whatever the container listens on, and pid 0 marks a
 * daemon this process did not spawn.
 */
export function pairInfoFromContainer(raw: string): {
	port: number;
	adminPort: number;
	pid: 0;
	token: string;
} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('could not read /data/proxy.json from the mock container');
	}
	const token =
		typeof parsed === 'object' && parsed !== null && 'token' in parsed ? parsed.token : undefined;
	if (typeof token !== 'string' || token === '') {
		throw new Error('the mock container has no admin token in /data/proxy.json yet');
	}
	return { port: 8080, adminPort: 8081, pid: 0, token };
}

/** The compose pair: `docker/` at the repo root in a checkout, inside the package once installed. */
export const composeFile = (): string => dataPaths().composeFile;

/**
 * What `docker compose` builds the mock image from. A checkout builds the
 * workspace (the verified path); an installed package builds from itself with
 * the Dockerfile shipped beside the compose file, and mounts the project the
 * user is standing in rather than a directory inside node_modules.
 */
export const composeEnv = (): NodeJS.ProcessEnv => {
	const p = dataPaths();
	if (p.layout === 'workspace') return process.env;
	return {
		...process.env,
		INTEGRATION_MOCK_BUILD_CONTEXT: join(p.composeFile, '..', '..'),
		INTEGRATION_MOCK_DOCKERFILE: 'docker/Dockerfile.package',
		INTEGRATION_MOCK_PROJECT_DIR: process.cwd(),
	};
};

/**
 * The daemon entry point, resolved relative to this file — never through a
 * workspace package name. Every entry point and chunk of the bundle is emitted
 * flat into `dist/`, so `./daemon.js` is a sibling wherever this code lands.
 */
export const daemonEntry = (): string => {
	const entry = fileURLToPath(new URL('./daemon.js', import.meta.url));
	if (!existsSync(entry)) {
		throw new Error(`integration-mock: daemon entry point missing at ${entry} — run \`pnpm build\``);
	}
	return entry;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function readInfo(): Promise<ProxyInfo> {
	try {
		return JSON.parse(await readFile(infoPath(), 'utf8')) as ProxyInfo;
	} catch {
		throw new Error('proxy not running — run `integration-mock start`');
	}
}

/** The CLI holds no state of its own; every verb goes through the running proxy. */
export async function adminClient(): Promise<AdminClient> {
	const i = await readInfo();
	return new AdminClient(`http://127.0.0.1:${i.adminPort}`, i.token);
}

/**
 * Like {@link adminClient} but `null` when no proxy is running, for verbs that
 * are still meaningful offline — `packs enable` writes config either way, and
 * that config is what the next `start` boots from.
 */
export async function tryAdminClient(): Promise<AdminClient | null> {
	try {
		await stat(infoPath());
	} catch {
		return null;
	}
	return adminClient();
}

/**
 * Push the enabled list to a running daemon, which re-reads the pack layers
 * before applying it. `false` when none is running — the config on disk is
 * what the next `start` boots from. Enabled packs are runtime state owned by
 * the proxy, so any verb that changes what is on disk or what is enabled
 * (`packs enable`/`disable`/`eject`) goes through here.
 */
export async function syncPacksWithProxy(): Promise<boolean> {
	const client = await tryAdminClient();
	if (!client) return false;
	await client.setEnabledPacks((await loadProjectConfig()).enabledPacks);
	return true;
}

export function registerProxy(p: Command, io: CliIo): void {
	p.command('start')
		.description('start the local proxy')
		.option('--port <n>', 'proxy port', '8080')
		.option('--admin-port <n>', 'admin port', '8081')
		.option('--foreground', 'run in this process')
		.action(async (o: { port: string; adminPort: string; foreground?: boolean }) => {
			if (o.foreground) {
				process.env.INTEGRATION_MOCK_PORT = o.port;
				process.env.INTEGRATION_MOCK_ADMIN_PORT = o.adminPort;
				const { runDaemon } = await import('integration-mock-proxy/daemon');
				await runDaemon();
				return;
			}
			const child = spawn(process.execPath, [daemonEntry()], {
				detached: true,
				stdio: 'ignore',
				env: { ...process.env, INTEGRATION_MOCK_PORT: o.port, INTEGRATION_MOCK_ADMIN_PORT: o.adminPort },
			});
			child.unref();
			for (let i = 0; i < 25; i++) {
				await sleep(200);
				if (await stat(infoPath()).then(() => true, () => false)) {
					io.write(`proxy started on :${o.port} (admin :${o.adminPort})`);
					return;
				}
			}
			throw new Error('proxy did not start within 5s');
		});

	p.command('up')
		.description('docker-compose n8n + mock')
		.addHelpText('after', () => `\nCompose file: ${composeFile()}`)
		.action(async () => {
			const n8nPort = Number(process.env.INTEGRATION_MOCK_N8N_PORT ?? 5690);
			// Preflight. The pair binds fixed ports, and the most common way in is
			// to follow the README's loop — which starts a local daemon on 8080
			// first. Colliding there produced containers that were created but
			// never started, while `up` still reported success.
			for (const [port, what] of [
				[8080, 'proxy'],
				[8081, 'admin API'],
				[n8nPort, 'n8n'],
			] as const) {
				if (await portInUse(port)) {
					throw new Error(
						`port ${port} (${what}) is already in use — run \`integration-mock stop\` if a local ` +
							`daemon holds it, \`integration-mock down\` if an older pair does, or set ` +
							`INTEGRATION_MOCK_N8N_PORT to move n8n`,
					);
				}
			}

			const r = spawnSync('docker', ['compose', '-f', composeFile(), 'up', '-d', '--build'], {
				stdio: 'inherit',
				env: composeEnv(),
			});
			if (r.status !== 0) throw new Error('docker compose up failed');

			// `up` exits 0 once containers are *created*; starting can still fail.
			// Verify both halves actually answer before claiming success.
			const adminUp = await waitFor(() => portInUse(8081), 60_000);
			if (!adminUp) {
				throw new Error(
					'the mock container did not come up — `docker compose -f ' +
						composeFile() +
						' logs mock`',
				);
			}
			const n8nUp = await waitFor(async () => {
				try {
					const res = await fetch(`http://localhost:${n8nPort}/healthz`);
					return res.ok;
				} catch {
					return false;
				}
			}, 120_000);
			if (!n8nUp) {
				throw new Error(
					`n8n did not become healthy on :${n8nPort} — \`docker compose -f ` +
						`${composeFile()} logs n8n\``,
				);
			}

			// The pair uses fixed ports, so the other verbs can reach it the same way —
			// but only with the admin token, which lives in the container's volume.
			const info = spawnSync(
				'docker',
				['compose', '-f', composeFile(), 'exec', '-T', 'mock', 'cat', '/data/proxy.json'],
				{ env: composeEnv(), encoding: 'utf8' },
			);
			if (info.status !== 0) {
				throw new Error('could not read the admin token from the mock container');
			}
			await mkdir(mockHome(), { recursive: true });
			await writeFile(infoPath(), JSON.stringify(pairInfoFromContainer(info.stdout)), { mode: 0o600 });
			io.write(`n8n on http://localhost:${n8nPort}, mock admin on :8081`);
		});

	p.command('down')
		.description('stop docker pair')
		.action(async () => {
			spawnSync('docker', ['compose', '-f', composeFile(), 'down'], { stdio: 'inherit', env: composeEnv() });
			await rm(infoPath(), { force: true });
			io.write('down');
		});

	p.command('stop')
		.description('stop the local proxy')
		.action(async () => {
			const i = await readInfo();
			try {
				process.kill(i.pid, 'SIGTERM');
			} catch {
				// already gone
			}
			await rm(infoPath(), { force: true });
			io.write('stopped');
		});

	p.command('status')
		.description('proxy state')
		.action(async () => {
			const s = await (await adminClient()).getState();
			io.write(`mode\t${s.mode}`);
			io.write(`packs\t${s.enabledPacks.join(', ') || '(none)'}`);
			io.write(
				`snapshot\t${s.activeSnapshot ? `${s.activeSnapshot.workflowId}/${s.activeSnapshot.executionId}` : '(none)'}`,
			);
			io.write(`faults\t${JSON.stringify(s.faults)}`);
		});

	p.command('on')
		.description('mode=replay')
		.action(async () => {
			await (await adminClient()).setMode('replay');
			io.write('mode: replay');
		});

	p.command('off')
		.description('mode=off')
		.action(async () => {
			await (await adminClient()).setMode('off');
			io.write('mode: off');
		});

	const rec = p.command('record').description('record real traffic into a pack');
	rec.command('start').description('start recording real traffic for the enabled services').action(async () => {
		await (await adminClient()).setMode('record');
		io.write('mode: record');
	});
	rec.command('stop').description('stop recording and switch to replay').action(async () => {
		await (await adminClient()).setMode('replay');
		io.write('mode: replay');
	});

	p.command('ca')
		.description('certificate authority')
		.command('install')
		.description('create the local CA if needed and print the proxy environment for n8n')
		.option('--host <h>', 'proxy host as seen by n8n', 'host.docker.internal')
		.option('--port <n>', 'proxy port (default: the running mock\'s port, else 8080)')
		.action(async (o: { host: string; port?: string }) => {
			const ca = await ensureCA();
			// The port n8n must reach is the one the mock listens on, so ask the
			// running mock before falling back to the default.
			const port = o.port ?? String(await readInfo().then((info) => info.port, () => 8080));
			// Without NO_PROXY n8n's task runner sends its loopback traffic to the mock and breaks.
			const noProxy = 'localhost,127.0.0.1';
			io.write(
				`# env for n8n (local process)\nHTTP_PROXY=http://127.0.0.1:${port}\nHTTPS_PROXY=http://127.0.0.1:${port}\nNO_PROXY=${noProxy}\nNODE_EXTRA_CA_CERTS=${ca.certPath}\n`,
			);
			io.write(
				`# docker-compose service snippet\n  environment:\n    HTTP_PROXY: http://${o.host}:${port}\n    HTTPS_PROXY: http://${o.host}:${port}\n    NO_PROXY: ${noProxy}\n    NODE_EXTRA_CA_CERTS: /certs/ca.pem\n  volumes:\n    - ${ca.certPath}:/certs/ca.pem:ro\n`,
			);
			io.write(
				`# hosted n8n (any platform that lets you set env vars; mock reachable at <public-host>)\nHTTP_PROXY=http://<public-host>:${port}\nHTTPS_PROXY=http://<public-host>:${port}\nNO_PROXY=${noProxy}\nNODE_EXTRA_CA_CERTS=/certs/ca.pem`,
			);
		});

	const faults = p.command('faults').description('fault injection');
	faults
		.command('set <service>')
		.description('make calls to a service fail, slow down or return nothing')
		.option('--status <n>', 'respond with this status')
		.option('--delay <ms>', 'delay before responding')
		.option('--empty', 'respond with an empty body')
		.option('--after <n>', 'let the first n calls through')
		.option('--once', 'retire after firing once')
		.action(
			async (
				service: string,
				o: { status?: string; delay?: string; empty?: boolean; after?: string; once?: boolean },
			) => {
				const spec: FaultSpec = {};
				if (o.status !== undefined) spec.status = Number(o.status);
				if (o.delay !== undefined) spec.delayMs = Number(o.delay);
				if (o.empty) spec.empty = true;
				if (o.after !== undefined) spec.after = Number(o.after);
				if (o.once) spec.once = true;
				await (await adminClient()).setFault(service, spec);
				io.write(`fault set: ${service} ${JSON.stringify(spec)}`);
			},
		);
	faults.command('clear [service]').description('remove faults from one service, or from all').action(async (service?: string) => {
		await (await adminClient()).clearFaults(service);
		io.write('faults cleared');
	});

	p.command('log')
		.description('request log')
		.option('--service <s>', 'filter by service')
		.option('--limit <n>', 'most recent n entries')
		.option('--follow', 'stream new entries')
		.action(async (o: { service?: string; limit?: string; follow?: boolean }) => {
			const c = await adminClient();
			const print = (entries: LogEntry[]): void => {
				for (const e of entries) {
					io.write(
						`${new Date(e.ts).toISOString()}\t${e.method}\t${e.service}\t${e.path}\t${e.status}\t${e.matchedRoute}${e.fault ? '\tFAULT' : ''}`,
					);
				}
			};
			print(
				await c.getLog({
					service: o.service,
					limit: o.limit !== undefined ? Number(o.limit) : undefined,
				}),
			);
			if (!o.follow) return;
			let since = Date.now();
			for (;;) {
				await sleep(500);
				const entries = await c.getLog({ service: o.service, since });
				if (entries.length) {
					print(entries);
					since = entries[entries.length - 1]!.ts + 1;
				}
			}
		});
}
