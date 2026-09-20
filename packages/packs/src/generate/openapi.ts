/** The subset of OpenAPI 3.x the generator reads. Anything else is ignored. */
export interface Schema {
	type?: string;
	format?: string;
	properties?: Record<string, Schema>;
	items?: Schema;
	required?: string[];
	enum?: unknown[];
	example?: unknown;
	default?: unknown;
	oneOf?: Schema[];
	anyOf?: Schema[];
	allOf?: Schema[];
	$ref?: string;
	nullable?: boolean;
}

export interface MediaType {
	schema?: Schema;
	example?: unknown;
	examples?: Record<string, { value?: unknown }>;
}

export interface Response {
	description?: string;
	content?: Record<string, MediaType>;
	/** Swagger 2.0 hangs the schema directly off the response. */
	schema?: Schema;
}

export interface Parameter {
	name: string;
	in: 'query' | 'path' | 'header' | 'cookie';
	required?: boolean;
	schema?: Schema;
	example?: unknown;
	$ref?: string;
}

export interface Operation {
	operationId?: string;
	summary?: string;
	parameters?: Parameter[];
	responses?: Record<string, Response>;
	deprecated?: boolean;
}

export type PathItem = Record<string, Operation | Parameter[] | undefined>;

export interface OAuthFlow {
	tokenUrl?: string;
	refreshUrl?: string;
	authorizationUrl?: string;
	scopes?: Record<string, string>;
}

export interface SecurityScheme {
	type?: string;
	scheme?: string;
	flows?: Record<string, OAuthFlow>;
	name?: string;
	in?: string;
}

export interface OpenApiDoc {
	openapi?: string;
	swagger?: string;
	info?: { title?: string; version?: string };
	servers?: Array<{ url: string }>;
	/** Swagger 2.0's equivalent of `servers`. */
	host?: string;
	basePath?: string;
	schemes?: string[];
	paths?: Record<string, PathItem>;
	components?: {
		schemas?: Record<string, unknown>;
		securitySchemes?: Record<string, SecurityScheme>;
	} & Record<string, unknown>;
	definitions?: Record<string, unknown>;
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
export type OpenApiMethod = (typeof HTTP_METHODS)[number];
