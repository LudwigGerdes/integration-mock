import {
	ResourceStore,
	resolve,
	type LayeredPacks,
	type MockRequest,
	type Resolution,
	type Route,
} from 'integration-mock-core';

/** Prove a mapper's routes actually serve, rather than just look right. */
export const serveThrough = (
	service: string,
	routes: Route[],
	req: Partial<MockRequest>,
): Resolution => {
	const packs: LayeredPacks = {
		library: [],
		user: [],
		project: [],
		snapshot: [{ id: service, domains: [], prefix: '/' + service, routes, source: 'snapshot:t' }],
	};
	return resolve(
		packs,
		service,
		{ method: 'GET', host: '', path: '/', query: {}, headers: {}, ...req },
		new ResourceStore(),
	);
};
