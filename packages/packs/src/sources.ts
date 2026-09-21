import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { dataPaths } from './paths.js';

export interface SpecSource {
	url: string;
	/** Vendors that publish one spec per API (HubSpot ships 117) list them here. */
	urls?: string[];
	license: string;
	sha256?: string;
	/** Which cached spec version under ~/.integration-mock/vendor-specs/<vendor>/ was used. */
	specVersion?: string;
	vendored: boolean;
	/**
	 * A spec kept for the audit and as a generator reference, not a pack in the
	 * library. `packs update` leaves it alone unless it is named explicitly.
	 */
	reference?: boolean;
	notes?: string;
}

export type Sources = Record<string, SpecSource>;

export const sourcesPath = (): string => dataPaths().sourcesFile;

/**
 * What a bare `packs update` refreshes: the vendored sources that back a library
 * pack. Whatever it refreshes is regenerated into the library, so a reference
 * spec in this list would become a pack nobody asked for.
 */
export const refreshable = (sources: Sources): string[] =>
	Object.keys(sources).filter((name) => sources[name]!.vendored && sources[name]!.reference !== true);

export async function loadSources(file: string = sourcesPath()): Promise<Sources> {
	try {
		return (parse(await readFile(file, 'utf8')) as Sources | null) ?? {};
	} catch {
		return {};
	}
}

/** Key-sorted so CI's refresh PR shows a reviewable diff. */
export async function saveSources(sources: Sources, file: string = sourcesPath()): Promise<void> {
	const sorted: Sources = {};
	for (const k of Object.keys(sources).sort()) sorted[k] = sources[k]!;
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, stringify(sorted));
}
