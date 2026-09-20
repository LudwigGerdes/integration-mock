export interface CredentialProperty {
	type?: string;
	enum?: string[];
	default?: unknown;
}

export interface CredentialSchema {
	type?: string;
	properties?: Record<string, CredentialProperty>;
	required?: string[];
}

/** UI-only property kinds that carry no data and must not be sent. */
const NON_DATA = new Set(['notice', 'hidden']);

/**
 * A dummy credential body conforming to a credential type's own schema.
 *
 * n8n refuses to run a workflow whose credential id does not resolve, before
 * any HTTP call is attempted — so the mock never sees the request. This exists
 * to satisfy that check, not to authenticate anything: the values are
 * deliberately inert placeholders.
 *
 * Schema-driven rather than per-vendor: n8n publishes the shape of every
 * credential type, so no hardcoded knowledge of Slack or Salesforce is needed.
 * Deterministic by construction — the same schema always yields the same body,
 * per the generation invariant.
 */
export function synthesizeCredential(
	schema: CredentialSchema,
	overrides: Record<string, string> = {},
): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const key of Object.keys(schema.properties ?? {}).sort()) {
		const prop = schema.properties![key]!;
		if (prop.type !== undefined && NON_DATA.has(prop.type)) continue;

		if (Object.prototype.hasOwnProperty.call(overrides, key)) {
			out[key] = overrides[key];
			continue;
		}
		if (prop.default !== undefined) {
			out[key] = prop.default;
			continue;
		}
		if (prop.enum !== undefined && prop.enum.length > 0) {
			out[key] = prop.enum[0];
			continue;
		}
		switch (prop.type) {
			case 'number':
				out[key] = 0;
				break;
			case 'boolean':
				out[key] = false;
				break;
			default:
				out[key] = 'integration-mock';
		}
	}

	// An override naming a field the schema does not declare is still honoured:
	// schemas lag reality, and refusing it would be more annoying than useful.
	for (const [k, v] of Object.entries(overrides)) if (!(k in out)) out[k] = v;

	return out;
}
