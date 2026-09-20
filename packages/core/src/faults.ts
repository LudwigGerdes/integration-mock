import type { FaultSpec, Faults } from './types.js';

/**
 * Fault injection state.
 *
 * Faults are runtime state, not code: the same mechanism backs the CLI's
 * `faults set`, a test's `given.faults`, and the inspector UI's toggles.
 * `after: n` lets the first n calls succeed; `once` retires the fault after
 * it fires a single time.
 */
export class FaultController {
	private specs = new Map<string, FaultSpec>();
	private counts = new Map<string, number>();

	set(service: string, spec: FaultSpec): void {
		this.specs.set(service, { ...spec });
		this.counts.set(service, 0);
	}

	clear(service?: string): void {
		if (service) {
			this.specs.delete(service);
			this.counts.delete(service);
		} else {
			this.specs.clear();
			this.counts.clear();
		}
	}

	/** The fault to apply for this call, consuming `after`/`once` counters. */
	next(service: string): FaultSpec | null {
		const spec = this.specs.get(service);
		if (!spec) return null;

		const n = (this.counts.get(service) ?? 0) + 1;
		this.counts.set(service, n);

		if (spec.after !== undefined && n <= spec.after) return null;
		if (spec.once) this.clear(service);

		const { after: _after, once: _once, ...applied } = spec;
		void _after;
		void _once;
		return applied;
	}

	snapshot(): Faults {
		return Object.fromEntries([...this.specs].map(([k, v]) => [k, { ...v }]));
	}
}
