import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Instance {
	name: string;
	url: string;
	apiKey: string;
}

export interface GlobalConfig {
	instances: Instance[];
	defaultInstance?: string;
}

export interface ProjectConfig {
	enabledPacks: string[];
	redact: string[];
	instance?: string;
}

/** Root for global state: CA, packs, proxy.json, config. Overridable for tests. */
export const mockHome = (): string =>
	process.env.INTEGRATION_MOCK_HOME ? process.env.INTEGRATION_MOCK_HOME : join(homedir(), '.integration-mock');

const globalPath = (): string => join(mockHome(), 'config.json');
const projectPath = (cwd = process.cwd()): string => join(cwd, '.integration-mock', 'config.json');

async function readJson<T>(p: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await readFile(p, 'utf8')) as T;
	} catch {
		return fallback;
	}
}

async function writeJson(p: string, v: unknown): Promise<void> {
	await mkdir(dirname(p), { recursive: true });
	await writeFile(p, JSON.stringify(v, null, 2) + '\n');
}

export const loadGlobalConfig = (): Promise<GlobalConfig> =>
	readJson(globalPath(), { instances: [] });

export const saveGlobalConfig = (c: GlobalConfig): Promise<void> => writeJson(globalPath(), c);

export const loadProjectConfig = (cwd?: string): Promise<ProjectConfig> =>
	readJson(projectPath(cwd), { enabledPacks: [], redact: [] });

export const saveProjectConfig = (c: ProjectConfig, cwd?: string): Promise<void> =>
	writeJson(projectPath(cwd), c);
