import { appendFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { redact } from './redact.js';
import type { LogEntry } from './types.js';

/**
 * Ring buffer of intercepted calls, optionally mirrored to a JSONL file.
 *
 * The log is the assertion interface for tests and the input to snapshot diffs,
 * so entries are append-only and carry everything a rule or assertion needs.
 */
export class RequestLog {
	private entries: LogEntry[] = [];
	private max: number;
	private file?: string;
	private redactPaths: string[];
	private pending: Promise<void> = Promise.resolve();

	constructor(opts: { max?: number; file?: string; redactPaths?: string[] } = {}) {
		this.max = opts.max ?? 5000;
		this.file = opts.file;
		this.redactPaths = opts.redactPaths ?? [];
	}

	append(e: Omit<LogEntry, 'id' | 'ts'>): LogEntry {
		const entry: LogEntry = { id: nanoid(12), ts: Date.now(), ...e };
		this.entries.push(entry);
		if (this.entries.length > this.max) {
			this.entries.splice(0, this.entries.length - this.max);
		}
		if (this.file) {
			const f = this.file;
			this.pending = this.pending
				// The file outlives the process and is plain text, so credentials never
				// reach it: credential headers, token-shaped strings and the project's
				// own `redact` paths. The in-memory entry stays as sent.
				.then(() => appendFile(f, JSON.stringify(redact(entry, { paths: this.redactPaths })) + '\n'))
				.catch(() => {});
		}
		return entry;
	}

	list(filter: { service?: string; since?: number; limit?: number } = {}): LogEntry[] {
		let out = this.entries;
		if (filter.service) out = out.filter((e) => e.service === filter.service);
		if (filter.since !== undefined) out = out.filter((e) => e.ts >= filter.since!);
		if (filter.limit !== undefined) out = out.slice(-filter.limit);
		return out.slice();
	}

	clear(): void {
		this.entries = [];
	}

	/** Await pending file writes (tests / shutdown). */
	flush(): Promise<void> {
		return this.pending;
	}
}
