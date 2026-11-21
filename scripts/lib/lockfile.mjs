// What the template accepts as the source of a package-lock.json entry (security
// audit of 2026-11-21, Template S5 and S6): an entry resolves from the npm
// registry and carries an sha integrity, so a lockfile cannot pull a package
// from a git repository, a file, a plain-http or another host without failing.
// Shared by scripts/check-pins.mjs, which checks every entry of the committed
// lockfile, and scripts/check-update-changes.mjs, which checks each entry an
// update changed.
// https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json

/** The only registry a lockfile entry may resolve from. */
export const REGISTRY = "https://registry.npmjs.org/";

const SHA_INTEGRITY = /^sha(256|384|512)-/;

/**
 * What is wrong with the source of one lockfile entry, one phrase per problem, none when it is fine.
 * @param {unknown} entry an entry of the `packages` map, other than the root entry ""
 * @param {{ allowBundled: boolean }} options a bundled dependency has neither `resolved` nor `integrity` and is covered by the integrity of the package that bundles it
 * @returns {string[]}
 */
export function sourceProblems(entry, { allowBundled }) {
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return ["is not an object"];
	/** @type {Record<string, unknown>} */
	const fields = entry;
	if (fields.link === true) return ["is a link"];
	if (fields.inBundle === true) return allowBundled ? [] : ["is bundled inside another package"];
	/** @type {string[]} */
	const problems = [];
	if (typeof fields.resolved !== "string" || !fields.resolved.startsWith(REGISTRY)) problems.push(`must resolve from ${REGISTRY}`);
	if (typeof fields.integrity !== "string" || !SHA_INTEGRITY.test(fields.integrity)) problems.push("must carry an sha integrity");
	return problems;
}
