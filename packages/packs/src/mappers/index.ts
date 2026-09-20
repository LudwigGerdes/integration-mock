import { registerMapper } from 'integration-mock-core';
import { airtableMapper } from './airtable.js';
import { googleSheetsMapper } from './google-sheets.js';
import { hubspotMapper } from './hubspot.js';
import { openAiMappers } from './openai.js';
import { slackMapper } from './slack.js';

export const ALL_MAPPERS = [
	slackMapper,
	googleSheetsMapper,
	airtableMapper,
	hubspotMapper,
	...openAiMappers,
];

/** Must run before `buildSnapshot`, or native nodes fall through to warnings. */
export function registerAllMappers(): void {
	for (const m of ALL_MAPPERS) registerMapper(m);
}

export { slackMapper, googleSheetsMapper, airtableMapper, hubspotMapper, openAiMappers };
