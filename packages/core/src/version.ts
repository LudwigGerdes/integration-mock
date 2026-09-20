/**
 * The n8n release this tool is built and tested against.
 *
 * Two constants, because n8n's libraries do not share the app's version
 * number: `n8n@2.38.3` depends on `n8n-workflow@2.38.1`. The app version is
 * what an instance reports and what users recognise; the workflow version
 * identifies the node parameter shapes the reverse mappers were written
 * against.
 *
 * These are declarations, not dependency pins. `n8n-workflow` was once a
 * dependency of this package and was never imported — 7.3MB carried for a
 * version number. It is recorded here instead, which is all anything needed.
 * If a future change genuinely imports from `n8n-workflow`, pin it exactly and
 * never as a range: tools resolving different minors disagree about parameter
 * shapes, and that surfaces as mysterious mismatches rather than a version
 * error.
 */
export const SUPPORTED_N8N_VERSION = '2.38.3';
export const SUPPORTED_N8N_WORKFLOW_VERSION = '2.38.1';
