import type { Command } from 'commander';
import { loadGlobalConfig, saveGlobalConfig } from 'integration-mock-core';
import type { CliIo } from '../index.js';

export function registerInstances(p: Command, io: CliIo): void {
	const c = p.command('instances').description('n8n instances (url + API key)');

	c.command('add <name> <url> <apiKey>')
		.description('save an n8n instance and its API key')
		.option('--default', 'make default')
		.action(async (name: string, url: string, apiKey: string, o: { default?: boolean }) => {
			const cfg = await loadGlobalConfig();
			cfg.instances = cfg.instances.filter((i) => i.name !== name).concat({ name, url, apiKey });
			if (o.default || cfg.instances.length === 1) cfg.defaultInstance = name;
			await saveGlobalConfig(cfg);
			io.write(`added ${name}`);
		});

	c.command('list').description('list saved n8n instances').action(async () => {
		const cfg = await loadGlobalConfig();
		for (const i of cfg.instances) {
			io.write(`${cfg.defaultInstance === i.name ? '*' : ' '} ${i.name}\t${i.url}`);
		}
	});

	c.command('use <name>').description('make a saved instance the default').action(async (name: string) => {
		const cfg = await loadGlobalConfig();
		if (!cfg.instances.some((i) => i.name === name)) throw new Error(`unknown instance ${name}`);
		cfg.defaultInstance = name;
		await saveGlobalConfig(cfg);
		io.write(`default: ${name}`);
	});
}
