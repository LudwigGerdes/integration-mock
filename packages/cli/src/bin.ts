#!/usr/bin/env node
import { buildProgram } from './index.js';

interface MaybeCommanderError {
	code?: string;
	exitCode?: number;
	message?: string;
}

buildProgram()
	.parseAsync(process.argv)
	.catch((e: unknown) => {
		const err = e as MaybeCommanderError;
		// buildProgram calls exitOverride(), so commander throws for --help and
		// --version rather than exiting. Those are successful outcomes: a --help
		// that exits non-zero breaks scripts and makes the tool look broken.
		// Commander carries its own exit code, so genuine misuse (an unknown
		// command, a missing argument) still exits 1.
		if (typeof err?.code === 'string' && err.code.startsWith('commander.')) {
			process.exit(err.exitCode ?? 0);
		}
		console.error(e instanceof Error ? e.message : e);
		// An error that names its own exit code (findings → 1) keeps it; anything
		// else is a usage or configuration problem.
		process.exit(typeof err?.exitCode === 'number' ? err.exitCode : 1);
	});
