import { defineWorkspace } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// A separate WORKSPACE, not just a separate config: vitest resolves
// vitest.workspace.ts in preference to --config, so a config file alone cannot
// isolate these. Instance tests need a real n8n and a running proxy, so they
// must never join the default offline run.
const pkg = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineWorkspace([
	{
		// NOTE: these files drive ONE shared daemon and ONE n8n, so they must run
		// serially — base-url.test.ts sets mode `off` by design, which flips
		// interception off underneath loop.test.ts if they overlap. That is
		// enforced by `--no-file-parallelism` in the `test:instance` script:
		// fileParallelism is a ROOT-level vitest option and is ignored here.
		test: { name: 'instance', root: '.', include: ['test/instance/**/*.test.ts'] },
		resolve: {
			// The repo root has no workspace deps installed; point at sources.
			alias: {
				'integration-mock-core': pkg('./packages/core/src/index.ts'),
				'integration-mock-proxy': pkg('./packages/proxy/src/index.ts'),
			},
		},
	},
]);
