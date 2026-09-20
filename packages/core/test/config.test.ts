import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	loadGlobalConfig,
	saveGlobalConfig,
	loadProjectConfig,
	saveProjectConfig,
} from '../src/config.js';

describe('config', () => {
	beforeEach(() => {
		process.env.INTEGRATION_MOCK_HOME = mkdtempSync(join(tmpdir(), 'home-'));
	});

	it('global defaults then round-trip', async () => {
		expect(await loadGlobalConfig()).toEqual({ instances: [] });
		await saveGlobalConfig({
			instances: [{ name: 'dev', url: 'http://x', apiKey: 'k' }],
			defaultInstance: 'dev',
		});
		expect((await loadGlobalConfig()).defaultInstance).toBe('dev');
	});

	it('project defaults then round-trip', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
		expect(await loadProjectConfig(cwd)).toEqual({ enabledPacks: [], redact: [] });
		await saveProjectConfig({ enabledPacks: ['slack'], redact: ['user.email'], instance: 'dev' }, cwd);
		expect(await loadProjectConfig(cwd)).toEqual({
			enabledPacks: ['slack'],
			redact: ['user.email'],
			instance: 'dev',
		});
	});
});
