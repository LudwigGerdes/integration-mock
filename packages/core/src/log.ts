import { appendFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
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
	private pending: Promise<void> = Promise.resolve();

	constructor(opts: { max?: number; file?: string } = {}) {
		this.max = opts.max ?? 5000;
		this.file = opts.file;
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
				.then(() => appendFile(f, JSON.stringify(entry) + '\n'))
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
