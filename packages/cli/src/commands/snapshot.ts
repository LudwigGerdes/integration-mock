import type { Command } from 'commander';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Dispatcher } from 'undici';
import {
	N8nClient,
	buildSnapshot,
	diffSnapshot,
	executionExportPath,
	loadGlobalConfig,
	loadProjectConfig,
	redact,
	snapshotPath,
	type Snapshot,
	type SnapshotDiff,
} from 'integration-mock-core';
import { registerAllMappers } from 'integration-mock-packs';
import type { CliIo } from '../index.js';
import { adminClient } from './proxy.js';

// Native-node mappers must be in the registry before any snapshot is built.
registerAllMappers();

let dispatcher: Dispatcher | undefined;

/** Lets the CLI tests drive N8nClient through undici's MockAgent. */
export function setDispatcherForTests(d: Dispatcher | undefined): void {
	dispatcher = d;
}

async function client(instanceFlag?: string): Promise<{ client: N8nClient; name: string }> {
	const [g, p] = await Promise.all([loadGlobalConfig(), loadProjectConfig()]);
	const name = instanceFlag ?? p.instance ?? g.defaultInstance;
	if (name === undefined) throw new Error('no instance configured — run `integration-mock instances add`');
	const inst = g.instances.find((i) => i.name === name);
	if (!inst) throw new Error(`unknown instance ${name}`);
	return { client: new N8nClient(inst, dispatcher), name };
}

/** Snapshots hold real responses, so they stay out of git unless asked for. */
async function ensureGitignore(cwd: string): Promise<void> {
	const f = join(cwd, '.gitignore');
	const cur = await readFile(f, 'utf8').catch(() => '');
	if (!cur.split('\n').includes('.integration-mock/snapshots/')) {
		await appendFile(f, (cur && !cur.endsWith('\n') ? '\n' : '') + '.integration-mock/snapshots/\n');
	}
}

export function registerSnapshot(p: Command, io: CliIo): void {
	p.command('snapshot <id>')
		.description('snapshot an execution (id or "latest") and activate it')
		.option('--instance <name>', 'n8n instance to read from')
		.option('--workflow <id>', 'workflow id (with "latest")')
		.option('--commit', 'keep the snapshot out of .gitignore')
		.option('--no-activate', 'write the snapshot without activating it')
		.action(
			async (
				id: string,
				o: { instance?: string; workflow?: string; commit?: boolean; activate: boolean },
			) => {
				const { client: c, name } = await client(o.instance);
				const proj = await loadProjectConfig();
				const exec =
					id === 'latest' ? await c.getLatestExecution(o.workflow) : await c.getExecution(id);
				const snap = buildSnapshot(exec, { instance: name, redact: { paths: proj.redact } });

				const file = snapshotPath(snap.workflowId, snap.executionId);
				await mkdir(dirname(file), { recursive: true });
				await writeFile(file, JSON.stringify(snap, null, 2));

				// Keep the API's own payload beside the derived snapshot, so
				// canvas and the test runner consume the real shape rather than ours.
				// Redacted with the same rules as the snapshot: an execution export is
				// full of live response bodies, and `--commit` deliberately skips the
				// gitignore, so an unredacted copy here goes straight into git.
				// Redaction preserves structure, which is what S4 consumers need.
				await writeFile(
					executionExportPath(snap.workflowId, snap.executionId),
					JSON.stringify(redact(exec, { paths: proj.redact }), null, 2),
				);
				if (!o.commit) await ensureGitignore(process.cwd());
				if (o.activate) await (await adminClient()).activateSnapshot(snap);

				io.write(`snapshot ${snap.workflowId}/${snap.executionId} → ${file}`);
				io.write('service\troutes\tdomains');
				for (const pk of snap.packs) {
					io.write(`${pk.id}\t${pk.routes.length}\t${pk.domains.join(',')}`);
				}
				for (const w of snap.warnings) io.write(`⚠ ${w}`);
				io.write(
					o.activate
						? 'Retry the workflow from anywhere; it now runs against this snapshot.'
						: 'Not activated (--no-activate).',
				);
			},
		);

	p.command('diff [id]')
		.description('diff an execution (default: latest) against the active snapshot')
		.option('--instance <name>', 'n8n instance to read from')
		.option('--json', 'print the raw SnapshotDiff')
		.action(async (id: string | undefined, o: { instance?: string; json?: boolean }) => {
			const a = await adminClient();
			const st = await a.getState();
			if (!st.activeSnapshot) throw new Error('no active snapshot — run integration-mock snapshot first');
			const snap = JSON.parse(
				await readFile(
					snapshotPath(st.activeSnapshot.workflowId, st.activeSnapshot.executionId),
					'utf8',
				),
			) as Snapshot;

			const { client: c } = await client(o.instance ?? snap.instance);
			const exec = id !== undefined ? await c.getExecution(id) : await c.getLatestExecution(snap.workflowId);
			const d: SnapshotDiff = diffSnapshot(snap, exec, await a.getLog({ since: snap.createdAt }));

			if (o.json) {
				io.write(JSON.stringify(d, null, 2));
				return;
			}
			io.write(`Changed nodes (${d.changedNodes.length})`);
			for (const n of d.changedNodes) io.write(`  ${n}`);
			io.write('Node outputs');
			for (const [n, v] of Object.entries(d.nodeOutputs)) {
				if (v.itemsBefore === v.itemsAfter && v.changedPaths.length === 0) continue;
				const shown = v.changedPaths.slice(0, 5).join(', ');
				const more = v.changedPaths.length > 5 ? ` (+${v.changedPaths.length - 5})` : '';
				io.write(
					`  ${n}: ${v.itemsBefore} → ${v.itemsAfter} items${v.changedPaths.length ? `; changed ${shown}${more}` : ''}`,
				);
			}
			io.write('Calls');
			for (const r of d.calls.missing) io.write(`  missing   ${r.id}`);
			for (const e of d.calls.added) io.write(`  added     ${e.method} ${e.service}${e.path}`);
			for (const ch of d.calls.changed) io.write(`  changed   ${ch.route.id}: ${ch.bodyDiff.join(', ')}`);
			for (const e of d.calls.unmatched) io.write(`  unmatched ${e.method} ${e.path}`);
			if (d.changedNodes.length) io.write(`Likely cause: edits to ${d.changedNodes.join(', ')}`);
		});
}
