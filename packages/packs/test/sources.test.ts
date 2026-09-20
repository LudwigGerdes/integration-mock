import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSources, saveSources } from '../src/sources.js';

describe('sources', () => {
	it('round-trips and writes keys sorted', async () => {
		const f = join(mkdtempSync(join(tmpdir(), 'src-')), 'sources.yaml');
		await saveSources(
			{
				zeta: { url: 'u2', license: 'MIT', vendored: false },
				alpha: { url: 'u1', license: 'MIT', vendored: true },
			},
			f,
		);
		const text = await readFile(f, 'utf8');
		expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'));
		expect(await loadSources(f)).toMatchObject({ alpha: { url: 'u1', vendored: true } });
	});

	it('a missing file is an empty manifest, not an error', async () =>
		expect(await loadSources('/nope/sources.yaml')).toEqual({}));
});
