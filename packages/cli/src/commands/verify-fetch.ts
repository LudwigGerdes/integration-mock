import { request } from 'undici';
import type { ActualResponse } from 'integration-mock-core';

export interface OutboundRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
}

/** Injectable so the CLI can be tested without touching a network. */
export type Fetcher = (req: OutboundRequest) => Promise<ActualResponse>;

/**
 * The only function in this package that reaches the network.
 *
 * Kept alone in its own file for the same reason as fetch-spec.ts: "can this
 * thing phone home?" stays answerable by reading a short list of named files.
 */
export const realFetcher: Fetcher = async (req) => {
	try {
		const res = await request(req.url, {
			method: req.method as 'GET',
			headers: req.headers,
		});
		const text = await res.body.text();
		let body: unknown = text;
		try {
			body = text === '' ? undefined : JSON.parse(text);
		} catch {
			/* non-JSON stays a string; diffShape reports the type disagreement */
		}
		return { status: res.statusCode, body };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
};
