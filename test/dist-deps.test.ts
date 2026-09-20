import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `fs.globSync` only exists from Node 22, and the packages declare Node >= 20,
 * so CI's Node 20 lane has to pass too. Recursive readdir (Node 20.1+) is enough.
 */
const jsFilesUnder = (dir: string): string[] =>
	readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.js'));

const packageManifests = (): string[] =>
	readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(ROOT, 'packages', d.name, 'package.json')))
		.map((d) => `packages/${d.name}/package.json`)
		.sort();

/** Only real module specifiers — prose inside a doc comment is not an import. */
const FROM = /^\s*(?:import|export)\b[^;\n]*?\bfrom\s+['"]([^'"]+)['"]/gm;

const bareName = (spec: string): string =>
	spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;

/**
 * Every module a built package imports must be one it declares.
 *
 * `ajv` sat in devDependencies while `pack-validate.ts` imported it at module
 * load — invisible here, because the workspace hoists everything, and fatal for
 * anyone installing the published package. Only a check against the *declared*
 * dependencies catches that.
 */
describe('published packages declare what they import', () => {
	const pkgs = packageManifests();

	it('finds packages to check', () => {
		expect(pkgs.length).toBeGreaterThan(0);
	});

	for (const rel of pkgs) {
		const manifest = JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as {
			name: string;
			dependencies?: Record<string, string>;
		};
		const distDir = join(ROOT, dirname(rel), 'dist');

		it(`${manifest.name} imports nothing undeclared`, () => {
			if (!existsSync(distDir)) return; // not built in this run
			const declared = new Set(Object.keys(manifest.dependencies ?? {}));
			const undeclared = new Set<string>();

			for (const js of jsFilesUnder(distDir)) {
				const src = readFileSync(join(distDir, js), 'utf8');
				for (const m of src.matchAll(FROM)) {
					const spec = m[1]!;
					if (spec.startsWith('.') || spec.startsWith('node:')) continue;
					const base = bareName(spec);
					if (!declared.has(base)) undeclared.add(base);
				}
			}
			expect([...undeclared].sort()).toEqual([]);
		});
	}
});
