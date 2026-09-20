import { describe, it, expect } from 'vitest';
import { assertReachable, resolveInstance } from './helpers/instance.js';

const instance = await resolveInstance();
const describeInstance = instance === undefined ? describe.skip : describe;

if (instance === undefined) {
	console.log(
		'[instance] no instance configured — skipping. Add one with: integration-mock instances add <name> <url> <key> --default',
	);
}

describeInstance('instance harness', () => {
	it('reaches the configured n8n', async () => {
		await expect(assertReachable(instance!)).resolves.toBeUndefined();
	});
});
