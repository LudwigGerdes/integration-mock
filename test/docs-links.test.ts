import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A gitignored path (`.integration-mock/config.json`, local runtime state) is a legitimate
 * thing for a doc to cite, but it is absent from a fresh checkout, so the guard
 * cannot demand it exists. `git check-ignore` exits 0 for ignored paths.
 */
function isGitIgnored(p: string): boolean {
	try {
		execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** Markdown inline link targets: [text](target). */
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
/** Backtick-quoted tokens — how AGENTS.md cites most of its paths. */
const BACKTICK = /`([^`\n]+)`/g;
/**
 * A backticked token we treat as a path to verify.
 *
 * Two conditions, and the separator is the load-bearing one. It admits
 * relative paths like `../x/y.md` — an earlier version anchored on a word
 * character and silently skipped every `../` path, i.e. exactly the drift this
 * guard exists to catch. It also excludes bare filenames such as `nodes.json`,
 * which docs cite by name rather than by location.
 */
const isPathToCheck = (t: string): boolean =>
	/\.(md|json|ts|yaml|yml)$/.test(t) &&
	t.includes('/') &&
	// `~/.integration-mock/proxy.json` is a runtime path under HOME, not a repo file.
	!t.startsWith('~') &&
	// `.../<workflowId>/<executionId>.json` is a template, not a location.
	!t.includes('<');

async function exists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Every relative path a doc cites must resolve, either against the repo root
 * (how AGENTS.md cites) or against the doc's own directory (how README cites).
 */
async function brokenPathsIn(file: string): Promise<string[]> {
	const text = await readFile(join(ROOT, file), 'utf8');
	const candidates = new Set<string>();

	for (const m of text.matchAll(MD_LINK)) {
		const t = (m[1] ?? '').split('#')[0].trim();
		if (t !== '' && !/^(https?:|mailto:)/.test(t)) candidates.add(t);
	}
	for (const m of text.matchAll(BACKTICK)) {
		const t = (m[1] ?? '').trim();
		if (isPathToCheck(t)) candidates.add(t);
	}

	const broken: string[] = [];
	for (const t of candidates) {
		if (isGitIgnored(t)) continue;
		const fromRoot = resolve(ROOT, t);
		const fromDoc = resolve(ROOT, dirname(file), t);
		if (!(await exists(fromRoot)) && !(await exists(fromDoc))) broken.push(t);
	}
	return broken.sort();
}

describe('documentation paths resolve', () => {
	for (const file of ['AGENTS.md', 'README.md', 'docs/adding-a-vendor.md']) {
		it(`${file} cites no missing paths`, async () => {
			expect(await brokenPathsIn(file)).toEqual([]);
		});
	}
});
