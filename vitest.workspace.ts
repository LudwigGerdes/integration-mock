import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
	'packages/*',
	{
		test: {
			// Repo-level checks that belong to no package: documentation integrity.
			name: 'repo',
			root: '.',
			include: ['test/**/*.test.ts'],
			// Instance tests need a live n8n — they run via vitest.instance.workspace.ts.
			exclude: ['**/node_modules/**', 'test/instance/**'],
		},
	},
]);
