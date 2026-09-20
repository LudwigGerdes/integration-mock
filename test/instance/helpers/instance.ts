import { loadGlobalConfig, type Instance } from 'integration-mock-core';

/** Matches core's stored `Instance` exactly: { name, url, apiKey }. */
export type TargetInstance = Instance;

/**
 * The instance these tests run against, or undefined when none is configured.
 *
 * Undefined must mean "skip", never "fail": a fresh clone has no instances, and
 * a suite that fails for everyone who has not set one up teaches people to
 * ignore it.
 */
export async function resolveInstance(): Promise<TargetInstance | undefined> {
	const cfg = await loadGlobalConfig();
	const all = cfg.instances ?? [];
	if (all.length === 0) return undefined;

	const wanted = process.env.INTEGRATION_MOCK_TEST_INSTANCE;
	if (wanted !== undefined) return all.find((i) => i.name === wanted);
	return all.find((i) => i.name === cfg.defaultInstance) ?? all[0];
}

/**
 * A configured instance that is not answering is a different condition from no
 * instance at all, and deserves a different message. Unconfigured means skip;
 * unreachable means fail — but say which instance, at which URL, and what to do.
 */
export async function assertReachable(inst: TargetInstance): Promise<void> {
	try {
		const res = await fetch(new URL('/healthz', inst.url));
		if (!res.ok) throw new Error(`healthz returned ${res.status}`);
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e);
		throw new Error(
			`instance "${inst.name}" at ${inst.url} is not answering (${why}). ` +
				`Start n8n there, point INTEGRATION_MOCK_TEST_INSTANCE at another instance, or ` +
				`remove it from ~/.integration-mock/config.json to make these tests skip.`,
		);
	}
}
