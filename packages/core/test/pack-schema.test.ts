import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { loadLayer } from '../src/pack-io.js';

const schemaPath = new URL('../../../schema/integration-mock.pack.schema.json', import.meta.url);

const compile = async (): ReturnType<Ajv2020['compile']> extends never
	? never
	: Promise<ReturnType<Ajv2020['compile']>> => {
	const ajv = new Ajv2020({ strict: false });
	return ajv.compile(JSON.parse(await readFile(fileURLToPath(schemaPath), 'utf8')) as object);
};

describe('pack schema', () => {
	it('accepts a minimal pack and rejects malformed ones', async () => {
		const validate = await compile();

		expect(
			validate({
				id: 'acme',
				domains: ['api.acme.test'],
				prefix: '/acme',
				source: 'authored',
				routes: [
					{ id: 'r1', match: { method: 'GET', path: '/x' }, respond: { status: 200 } },
				],
			}),
		).toBe(true);

		// No domains is VALID: a pack reachable only by its prefix, such as the
		// generic REST fallback, stands in for no particular vendor host.
		expect(
			validate({ id: 'generic-rest', domains: [], prefix: '/generic-rest', source: 'library', routes: [] }),
		).toBe(true);
		// uppercase id
		expect(validate({ id: 'Acme', domains: ['x'], prefix: '/acme', source: 'authored', routes: [] })).toBe(false);
		// prefix without leading slash
		expect(validate({ id: 'acme', domains: ['x'], prefix: 'acme', source: 'authored', routes: [] })).toBe(false);
		// method that is not an HTTP verb
		expect(
			validate({
				id: 'acme',
				domains: ['x'],
				prefix: '/acme',
				source: 'authored',
				routes: [{ id: 'r', match: { method: 'FETCH', path: '/x' } }],
			}),
		).toBe(false);
	});

	it('every shipped pack validates against it', async () => {
		const validate = await compile();
		const dir = fileURLToPath(new URL('../../packs/packs', import.meta.url));
		const packs = await loadLayer(dir);

		expect(packs.length).toBeGreaterThan(20);
		const bad = packs
			.filter((p) => !validate(p))
			.map((p) => `${p.id}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
		expect(bad).toEqual([]);
	});
});

it('the published JSON file matches the schema actually used to validate', async () => {
	// The TS module is the source of truth; the file is published for consumers.
	// If they drift, packs validate against something other than what is
	// documented, and nobody finds out.
	const { PACK_SCHEMA } = await import('../src/pack-schema.js');
	const onDisk = JSON.parse(await readFile(fileURLToPath(schemaPath), 'utf8')) as unknown;
	expect(onDisk).toEqual(PACK_SCHEMA);
});
