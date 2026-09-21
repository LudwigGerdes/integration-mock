import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '../src/index.js';

const walk = (cmd: Command, path: string[] = []): { path: string; description: string }[] =>
	cmd.commands.flatMap((c) => {
		const here = [...path, c.name()];
		return [{ path: here.join(' '), description: c.description() }, ...walk(c, here)];
	});

describe('--help', () => {
	it('describes every command and subcommand', () => {
		const missing = walk(buildProgram())
			.filter((c) => c.description.trim() === '')
			.map((c) => c.path);
		expect(missing).toEqual([]);
	});
});
