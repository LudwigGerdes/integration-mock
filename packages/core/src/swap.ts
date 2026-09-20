import type { ServicePack } from './types.js';

export interface UrlChange {
	node: string;
	from: string;
	to: string;
}

export interface SwapResult {
	workflow: unknown;
	changes: UrlChange[];
	/** Nodes whose URL looked swappable but could not be resolved, with why. */
	skipped: Array<{ node: string; url: string; reason: string }>;
}

interface WorkflowNode {
	name?: string;
	type?: string;
	parameters?: Record<string, unknown>;
}

/** Only this node exposes a per-node proxy setting; native nodes have none. */
const HTTP_REQUEST = 'n8n-nodes-base.httpRequest';

const hostMatches = (domain: string, host: string): boolean =>
	domain.startsWith('*.')
		? host === domain.slice(2) || host.endsWith('.' + domain.slice(2))
		: domain === host;

/** The first concrete domain a pack claims — a wildcard cannot be turned back into a host. */
const concreteDomain = (pack: ServicePack): string | undefined =>
	pack.domains.find((d) => !d.startsWith('*.'));

/**
 * Re-point a workflow's HTTP Request URLs at the mock, or back at the vendor.
 *
 * Reversal keeps no state: a mock URL carries the prefix, the prefix names the
 * pack, and the pack names the vendor host. A backup file would be one more
 * thing to lose, and would go stale the moment someone edited the workflow.
 *
 * Expression URLs (`={{ … }}`) are left alone and reported. Their host is not
 * known statically, so rewriting them would be guesswork.
 */
export function swapWorkflowUrls(
	workflow: unknown,
	packs: ServicePack[],
	opts: { direction: 'mock' | 'real'; baseUrl: string; via?: 'url' | 'proxy' },
): SwapResult {
	const changes: UrlChange[] = [];
	const skipped: SwapResult['skipped'] = [];

	const clone = JSON.parse(JSON.stringify(workflow)) as { nodes?: WorkflowNode[] };
	const base = opts.baseUrl.replace(/\/$/, '');

	for (const node of clone.nodes ?? []) {
		const url = node.parameters?.url;
		if (typeof url !== 'string' || url === '') continue;
		const name = node.name ?? '(unnamed)';

		if (url.startsWith('=')) {
			skipped.push({ node: name, url, reason: 'expression URL — host is not known statically' });
			continue;
		}

		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			skipped.push({ node: name, url, reason: 'not an absolute URL' });
			continue;
		}

		// `via: 'proxy'` sets the node's own Proxy option instead of rewriting the
		// URL. This is the only way to intercept on n8n Cloud, where the process
		// environment cannot be touched — and it works only on HTTP Request
		// nodes, since no native node exposes a proxy setting.
		if (opts.via === 'proxy') {
			if (node.type !== HTTP_REQUEST) {
				skipped.push({
					node: name,
					url,
					reason: `${node.type ?? 'node'} exposes no proxy option — only ${HTTP_REQUEST} does`,
				});
				continue;
			}
			const options = (node.parameters!.options ??= {}) as Record<string, unknown>;

			if (opts.direction === 'mock') {
				const pack = packs.find((p) => p.domains.some((d) => hostMatches(d, parsed.hostname)));
				if (pack === undefined) continue;
				options.proxy = base;
				// Only where TLS is actually involved: the mock terminates HTTPS
				// with its own CA, which the host will not trust. Weakening
				// verification on a plain-HTTP call would buy nothing.
				if (parsed.protocol === 'https:') options.allowUnauthorizedCerts = true;
				changes.push({ node: name, from: url, to: `${url} via proxy ${base}` });
				continue;
			}

			if (options.proxy !== base) continue;
			delete options.proxy;
			// Clearing this matters more than setting it did: a node left ignoring
			// certificate errors while pointed at a real vendor is a silent
			// downgrade, exactly at cutover.
			delete options.allowUnauthorizedCerts;
			changes.push({ node: name, from: `${url} via proxy ${base}`, to: url });
			continue;
		}

		if (opts.direction === 'mock') {
			const pack = packs.find((p) => p.domains.some((d) => hostMatches(d, parsed.hostname)));
			if (pack === undefined) continue;
			const to = `${base}${pack.prefix}${parsed.pathname}${parsed.search}`;
			node.parameters!.url = to;
			changes.push({ node: name, from: url, to });
			continue;
		}

		// direction === 'real': recognise our own base URL and undo the prefix.
		if (!url.startsWith(base + '/')) continue;
		const rest = parsed.pathname;
		const pack = packs.find((p) => rest === p.prefix || rest.startsWith(p.prefix + '/'));
		if (pack === undefined) {
			skipped.push({ node: name, url, reason: 'no enabled pack claims that prefix' });
			continue;
		}
		const domain = concreteDomain(pack);
		if (domain === undefined) {
			skipped.push({
				node: name,
				url,
				reason: `pack "${pack.id}" declares only wildcard domains, so the original host is unknown`,
			});
			continue;
		}
		const to = `https://${domain}${rest.slice(pack.prefix.length) || '/'}${parsed.search}`;
		node.parameters!.url = to;
		changes.push({ node: name, from: url, to });
	}

	return { workflow: clone, changes, skipped };
}
