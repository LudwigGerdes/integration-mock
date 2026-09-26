/**
 * The CLI's version, as a constant rather than a package.json read.
 *
 * Reading package.json at runtime means resolving a path relative to the
 * module, which breaks once the code is bundled — the same trap that caught the
 * pack schema. `version.test.ts` asserts this matches the manifest, so the two
 * cannot drift.
 */
export const CLI_VERSION = '0.2.0';
