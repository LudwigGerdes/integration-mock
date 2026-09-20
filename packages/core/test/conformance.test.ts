import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { normalizeTestFile } from '../src/test-file.js';

const repoFile = (p: string): string =>
	readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

const schema = JSON.parse(repoFile('schema/integration-mock.test.schema.json')) as object;
const casesYaml = parse(repoFile('conformance/suite.cases.yaml')) as unknown;
const expected = JSON.parse(repoFile('conformance/suite.cases.expected.json')) as unknown;

describe('S2 conformance — test file format', () => {
	it('the published fixture validates against the published schema', () => {
		const ajv = new Ajv2020({ strict: false });
		const validate = ajv.compile(schema);
		const ok = validate(casesYaml);
		// Print why, so a drifting fixture says what broke rather than just "false".
		expect(validate.errors ?? []).toEqual([]);
		expect(ok).toBe(true);
	});

	it('normalizing the fixture produces exactly the published expected output', () => {
		expect(normalizeTestFile(casesYaml)).toEqual(expected);
	});

	it('rejects a file carrying both a cases list and a top-level when', () => {
		const ajv = new Ajv2020({ strict: false });
		const validate = ajv.compile(schema);
		expect(validate({ workflow: 'w', when: { payload: {} }, cases: [{ id: 'a', when: {} }] })).toBe(
			false,
		);
	});

	it('requires an id on every case', () => {
		const ajv = new Ajv2020({ strict: false });
		const validate = ajv.compile(schema);
		expect(validate({ workflow: 'w', cases: [{ when: { payload: {} } }] })).toBe(false);
	});

	it('normalizes the single-case form to one case', () => {
		const out = normalizeTestFile({ workflow: 'w', when: { payload: { a: 1 } }, then: { noUnmatched: true } });
		expect(out.cases).toHaveLength(1);
		expect(out.cases[0]!.id).toBe('default');
	});
});
