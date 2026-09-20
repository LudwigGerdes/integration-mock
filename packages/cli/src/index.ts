import { Command } from 'commander';
import { CLI_VERSION } from './version.js';
import { registerInstances } from './commands/instances.js';
import { registerPacks } from './commands/packs.js';
import { registerProxy } from './commands/proxy.js';
import { registerSnapshot } from './commands/snapshot.js';
import { registerUrl } from './commands/url.js';
import { registerCreds } from './commands/creds.js';
import { registerVerify } from './commands/verify.js';

export interface CliIo {
	write: (s: string) => void;
}

export function buildProgram(
	io: CliIo = { write: (s) => process.stdout.write(s + '\n') },
): Command {
	const p = new Command('integration-mock')
		.description('Mock APIs, snapshot/retry and tests for n8n workflows')
		.version(CLI_VERSION)
		.exitOverride();

	registerProxy(p, io);
	registerUrl(p, io);

	registerInstances(p, io);
	registerPacks(p, io);

	registerCreds(p, io);

	registerSnapshot(p, io);
	registerVerify(p, io);


	return p;
}
