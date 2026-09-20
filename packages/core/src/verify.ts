import { diffShape, type ShapeDiff } from './shape.js';
import type { Route } from './types.js';

export interface RouteFinding {
	route: string;
	kind: 'status' | 'shape' | 'unreachable' | 'skipped';
	message: string;
	diffs?: ShapeDiff[];
}

/** Methods that cannot change state on the vendor's side. */
export const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Is replaying this route against the real vendor free of side effects?
 *
 * A wildcard method counts as unsafe: it includes the writes. Verification runs
 * against a real tenant, and the failure being designed against is someone
 * verifying a Slack pack and posting live messages.
 */
export const isSafe = (route: Route): boolean => SAFE_METHODS.includes(route.match.method);

export type ActualResponse = { status: number; body: unknown } | { error: string };

/** What one route's verification found. Empty means the pack agrees with reality. */
export function compareRoute(route: Route, actual: ActualResponse): RouteFinding[] {
	if ('error' in actual) {
		return [{ route: route.id, kind: 'unreachable', message: actual.error }];
	}
	if (route.respond === undefined) {
		return [
			{ route: route.id, kind: 'skipped', message: 'route has no respond block to compare' },
		];
	}

	if (route.respond.status !== actual.status) {
		// Stop here: an error body has a different shape by nature, so also
		// reporting every field would bury the finding that matters.
		return [
			{
				route: route.id,
				kind: 'status',
				message: `pack says ${route.respond.status}, vendor said ${actual.status}`,
			},
		];
	}

	const diffs = diffShape(route.respond.body, actual.body);
	if (diffs.length === 0) return [];

	const invented = diffs.filter((d) => d.kind === 'invented').length;
	return [
		{
			route: route.id,
			kind: 'shape',
			message:
				invented > 0
					? `${diffs.length} shape difference(s), including ${invented} field(s) the pack invented`
					: `${diffs.length} shape difference(s)`,
			diffs,
		},
	];
}
