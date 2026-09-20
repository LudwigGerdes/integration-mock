import { describe, it, expect, afterEach } from 'vitest';
import { RequestLog, FaultController } from 'integration-mock-core';
import { MockEngine } from '../src/state.js';
import { startAdmin, AdminClient } from '../src/admin.js';

const newEngine = (): MockEngine =>
	new MockEngine({
		packs: { library: [], user: [], project: [], snapshot: [] },
		log: new RequestLog(),
		faults: new FaultController(),
	});

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
	await stop?.();
	stop = undefined;
	delete process.env.INTEGRATION_MOCK_ADMIN_BIND;
});

describe('admin auth', () => {
	it('loopback needs no token — existing behaviour is unchanged', async () => {
		const admin = await startAdmin({ engine: newEngine(), port: 0 });
		stop = admin.close;
		const res = await fetch(`http://127.0.0.1:${admin.port}/state`);
		expect(res.status).toBe(200);
	});

	it('refuses to start on a non-loopback bind with no token', async () => {
		process.env.INTEGRATION_MOCK_ADMIN_BIND = '0.0.0.0';
		await expect(startAdmin({ engine: newEngine(), port: 0 })).rejects.toThrow(/requires a token/);
	});

	it('rejects a missing or wrong token on a non-loopback bind', async () => {
		process.env.INTEGRATION_MOCK_ADMIN_BIND = '0.0.0.0';
		const admin = await startAdmin({ engine: newEngine(), port: 0, token: 'right' });
		stop = admin.close;

		const none = await fetch(`http://127.0.0.1:${admin.port}/state`);
		expect(none.status).toBe(401);

		const wrong = await fetch(`http://127.0.0.1:${admin.port}/state`, {
			headers: { authorization: 'Bearer wrong' },
		});
		expect(wrong.status).toBe(401);
	});

	it('accepts the right token, and AdminClient sends it', async () => {
		process.env.INTEGRATION_MOCK_ADMIN_BIND = '0.0.0.0';
		const admin = await startAdmin({ engine: newEngine(), port: 0, token: 'right' });
		stop = admin.close;

		const client = new AdminClient(`http://127.0.0.1:${admin.port}`, 'right');
		expect((await client.getState()).mode).toBe('off');
	});
});
