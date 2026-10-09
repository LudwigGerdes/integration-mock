import { matchPath } from './matcher.js';
import type { HttpMethod, MockRequest } from './types.js';

export type AuthMode = 'revoked' | 'forbidden';

export interface RateLimitScenario {
	calls: number;
	perMs: number;
	/** Only calls matching this count and are limited. Path uses pack-route syntax. */
	route?: { method: HttpMethod | '*'; path: string };
}

export type ScenarioHit =
	| { kind: 'auth'; mode: AuthMode }
	| { kind: 'rateLimit'; retryAfterSec: number; limit: number; resetAt: number };

export interface ScenarioState {
	auth: Record<string, AuthMode>;
	limits: Record<string, RateLimitScenario>;
}

interface Window {
	spec: RateLimitScenario;
	start?: number;
	used: number;
}

/**
 * Failure scenarios a user switches on per service: rejected credentials and
 * rate limits. Runtime state like faults; checked before faults and routing.
 * The limiter is a fixed window opened by the first counted call.
 */
export class ScenarioController {
	private auth = new Map<string, AuthMode>();
	private limits = new Map<string, Window>();

	constructor(private readonly now: () => number = Date.now) {}

	setAuth(service: string, mode: AuthMode): void {
		this.auth.set(service, mode);
	}

	clearAuth(service?: string): void {
		if (service === undefined) this.auth.clear();
		else this.auth.delete(service);
	}

	setLimit(service: string, limit: RateLimitScenario): void {
		this.limits.set(service, { spec: { ...limit }, used: 0 });
	}

	clearLimit(service?: string): void {
		if (service === undefined) this.limits.clear();
		else this.limits.delete(service);
	}

	check(service: string, req: MockRequest): ScenarioHit | null {
		const mode = this.auth.get(service);
		if (mode !== undefined) return { kind: 'auth', mode };

		const w = this.limits.get(service);
		if (!w) return null;
		const r = w.spec.route;
		if (r && ((r.method !== '*' && r.method !== req.method) || matchPath(r.path, req.path) === null)) return null;

		const t = this.now();
		if (w.start === undefined || t >= w.start + w.spec.perMs) {
			w.start = t;
			w.used = 0;
		}
		if (w.used < w.spec.calls) {
			w.used++;
			return null;
		}
		const end = w.start + w.spec.perMs;
		return {
			kind: 'rateLimit',
			retryAfterSec: Math.max(1, Math.ceil((end - t) / 1000)),
			limit: w.spec.calls,
			resetAt: Math.ceil(end / 1000),
		};
	}

	snapshot(): ScenarioState {
		return {
			auth: Object.fromEntries(this.auth),
			limits: Object.fromEntries([...this.limits].map(([k, w]) => [k, { ...w.spec }])),
		};
	}
}
