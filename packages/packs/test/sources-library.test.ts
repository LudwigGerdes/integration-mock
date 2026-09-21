import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { libraryPacksDir, loadSources, refreshable } from '../src/index.js';

/**
 * The weekly refresh job runs `packs update` with no names and then the test
 * suite. Whatever that command would rebuild lands in the library, so every
 * such source has to be a library pack already: a source that is not one would
 * be generated into the library as a new pack, and fail the suite.
 */
describe('sources.yaml and the pack library', () => {
	it('only refreshes sources that are library packs', async () => {
		const sources = await loadSources();
		const strays = refreshable(sources).filter(
			(name) => !existsSync(join(libraryPacksDir(), name, 'pack.json')),
		);
		expect(strays).toEqual([]);
	});

	it('leaves a reference spec alone', () => {
		expect(
			refreshable({
				acme: { url: 'https://example.test/a.json', license: 'MIT', vendored: true },
				sample: { url: 'https://example.test/s.json', license: 'MIT', vendored: true, reference: true },
				onDemand: { url: 'https://example.test/o.json', license: 'unknown', vendored: false },
			}),
		).toEqual(['acme']);
	});
});
