export type ShapeDiffKind = 'invented' | 'missing' | 'type';

export interface ShapeDiff {
	kind: ShapeDiffKind;
	path: string;
	/** JSON type on the mock side, where it has one. */
	mock?: string;
	/** JSON type on the real side, where it has one. */
	real?: string;
}

const typeOf = (v: unknown): string =>
	v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

/**
 * Structural comparison of a mocked response against a real one.
 *
 * Values are deliberately ignored. Real data differs from mock data by
 * definition, so comparing values would bury the signal; what matters is
 * whether the same fields exist with the same types.
 *
 * `invented` — present in the mock, absent from reality — is the finding that
 * matters most. It is the debt incurred whenever an authored pack guessed a
 * field name: harmless in the mock, and a failure at cutover.
 */
export function diffShape(mock: unknown, real: unknown): ShapeDiff[] {
	const out: ShapeDiff[] = [];

	const walk = (m: unknown, r: unknown, path: string): void => {
		const mt = typeOf(m);
		const rt = typeOf(r);
		if (mt !== rt) {
			out.push({ kind: 'type', path: path === '' ? '$' : path, mock: mt, real: rt });
			return;
		}

		if (mt === 'object') {
			const mo = m as Record<string, unknown>;
			const ro = r as Record<string, unknown>;
			// Sorted so a report is stable between runs.
			for (const k of Object.keys(mo).sort()) {
				const p = path === '' ? k : `${path}.${k}`;
				if (!(k in ro)) out.push({ kind: 'invented', path: p, mock: typeOf(mo[k]) });
				else walk(mo[k], ro[k], p);
			}
			for (const k of Object.keys(ro).sort()) {
				if (!(k in mo)) {
					out.push({
						kind: 'missing',
						path: path === '' ? k : `${path}.${k}`,
						real: typeOf(ro[k]),
					});
				}
			}
			return;
		}

		if (mt === 'array') {
			const ma = m as unknown[];
			const ra = r as unknown[];
			// Element shape only: a mock holding two records where reality holds
			// fifty is data, not a difference worth reporting.
			if (ma.length > 0 && ra.length > 0) walk(ma[0], ra[0], `${path}[]`);
		}
	};

	walk(mock, real, '');
	return out;
}
