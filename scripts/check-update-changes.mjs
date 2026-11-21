// The content of an update, checked before .github/workflows/fleet-update.yml
// stores it as an artifact (security audit of 2026-11-21, Template S5; app plan,
// Health, plugins and updates). The workflow's path check judges which files
// changed; Fleet commits them to the repository, so this check judges what
// changed in them, by comparing the working tree after `npm install` with
// package.json and package-lock.json at HEAD, the commit the run started on:
//
// - package.json differs only in the version of the named dependencies (the
//   plugin, or emdash and @emdash-cms/cloudflare for a core update), each at
//   exactly the version the update names; no script, override, allowScripts,
//   packageManager, engines or workspaces entry moves with it;
// - package-lock.json is lockfileVersion 3 in both, installs each named
//   package at that version, and every entry it changed or added resolves from
//   https://registry.npmjs.org/ with an sha integrity, is no link and no
//   file:, git or URL entry; a bundled dependency (inBundle) has neither field
//   and is covered by the integrity of its parent;
// - a name@version that was in the lockfile at HEAD still has its integrity,
//   because npm versions are immutable and a core update removes and
//   re-resolves the entries of the EmDash packages;
// - a core update moves emdash to a version above the one installed at HEAD,
//   never a downgrade (the workflow already refuses a prerelease, HR-176).
//
// Usage (the workflow sets KIND, PACKAGE and VERSION; run from the repository root):
//   node scripts/check-update-changes.mjs
// https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
// https://docs.npmjs.com/cli/v11/configuring-npm/package-json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { sourceProblems } from "./lib/lockfile.mjs";
import { report } from "./lib/report.mjs";

const VERSION_GROUPS = ["dependencies", "devDependencies", "optionalDependencies"];
const CORE_PACKAGES = ["emdash", "@emdash-cms/cloudflare"];

/** @typedef {import("./lib/report.mjs").Finding} Finding */

/**
 * @typedef {object} Tree
 * @property {Record<string, unknown>} pkg package.json as plain values
 * @property {Record<string, unknown>} lock package-lock.json as plain values
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A string that is equal for equal values whatever the order of their keys.
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "undefined";
}

/**
 * Whether `version` is above `current`, both exact versions; a stable release is above a prerelease of its own number.
 * @param {string} version
 * @param {string} current
 * @returns {boolean} false when either is not an exact version
 */
export function isNewer(version, current) {
	const pattern = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
	const next = pattern.exec(version);
	const now = pattern.exec(current);
	if (next === null || now === null) return false;
	for (const index of [1, 2, 3]) {
		const difference = Number(next[index]) - Number(now[index]);
		if (difference !== 0) return difference > 0;
	}
	return now[4] !== undefined && next[4] === undefined;
}

/**
 * The package.json findings: only the named dependencies move, each to exactly `version`.
 * @param {readonly string[]} names
 * @param {string} version
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {Finding[]}
 */
function packageFindings(names, version, before, after) {
	/** @param {Record<string, unknown>} pkg */
	const without = (pkg) => {
		/** @type {Record<string, unknown>} */
		const copy = structuredClone(pkg);
		for (const group of VERSION_GROUPS) {
			const entries = copy[group];
			if (!isObject(entries)) continue;
			for (const name of names) delete entries[name];
			if (Object.keys(entries).length === 0) delete copy[group];
		}
		return copy;
	};
	const rest = { before: without(before), after: without(after) };
	const changed = [...new Set([...Object.keys(rest.before), ...Object.keys(rest.after)])].filter((key) => canonical(rest.before[key]) !== canonical(rest.after[key]));
	/** @type {Finding[]} */
	const findings = [];
	if (changed.length > 0) {
		findings.push({ file: "package.json", rule: "package-json", message: `an update changes only the version of ${names.join(" and ")}, found a change to ${changed.toSorted().join(", ")}` });
	}
	for (const name of names) {
		const listed = VERSION_GROUPS.flatMap((group) => {
			const entries = after[group];
			return isObject(entries) && entries[name] !== undefined ? [entries[name]] : [];
		});
		if (listed.length === 0 || listed.some((spec) => spec !== version)) {
			findings.push({ file: "package.json", rule: "package-json", message: `${name} must be listed at exactly ${version}` });
		}
	}
	return findings;
}

/**
 * The name a lockfile entry installs: its `name` field for an alias, else the last node_modules segment of its path.
 * @param {string} path
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function entryName(path, entry) {
	if (typeof entry.name === "string") return entry.name;
	const marker = "node_modules/";
	return path.slice(path.lastIndexOf(marker) + marker.length);
}

/**
 * The package-lock.json findings.
 * @param {readonly string[]} names
 * @param {string} version
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {Finding[]}
 */
function lockFindings(names, version, before, after) {
	const file = "package-lock.json";
	/** @type {Finding[]} */
	const findings = [];
	if (before.lockfileVersion !== 3 || after.lockfileVersion !== 3) {
		findings.push({ file, rule: "lockfile", message: `lockfileVersion must be 3 before and after the update, found ${String(before.lockfileVersion)} and ${String(after.lockfileVersion)}` });
	}
	if (!isObject(before.packages) || !isObject(after.packages)) {
		findings.push({ file, rule: "lockfile", message: "the lockfile has no packages map" });
		return findings;
	}
	const known = new Map();
	for (const [path, entry] of Object.entries(before.packages)) {
		if (path === "" || !isObject(entry) || typeof entry.version !== "string" || typeof entry.integrity !== "string") continue;
		const key = `${entryName(path, entry)}@${entry.version}`;
		known.set(key, new Set([...(known.get(key) ?? []), entry.integrity]));
	}
	for (const [path, entry] of Object.entries(after.packages)) {
		if (path === "" || !isObject(entry)) continue;
		if (typeof entry.version === "string" && typeof entry.integrity === "string") {
			const integrities = known.get(`${entryName(path, entry)}@${entry.version}`);
			if (integrities !== undefined && !integrities.has(entry.integrity)) {
				findings.push({ file, rule: "integrity", message: `${path} is ${entry.version} with a different integrity than before the update` });
			}
		}
		if (canonical(before.packages[path]) === canonical(entry)) continue;
		for (const problem of sourceProblems(entry, { allowBundled: true })) findings.push({ file, rule: "registry", message: `${path} ${problem}` });
	}
	for (const name of names) {
		const installed = after.packages[`node_modules/${name}`];
		if (!isObject(installed) || installed.version !== version) findings.push({ file, rule: "lockfile", message: `the lockfile must install ${name} at ${version}` });
	}
	return findings;
}

/**
 * The findings of an update: what its working tree changed in package.json and package-lock.json against HEAD.
 * @param {{ kind: string, name: string, version: string, before: Tree, after: Tree }} update `name` is the package of the update
 * @returns {Finding[]}
 */
export function updateFindings({ kind, name, version, before, after }) {
	if (kind !== "plugin" && kind !== "core") return [{ file: "package.json", rule: "update", message: "kind must be plugin or core" }];
	const names = kind === "core" ? CORE_PACKAGES : [name];
	const findings = [...packageFindings(names, version, before.pkg, after.pkg), ...lockFindings(names, version, before.lock, after.lock)];
	if (kind === "core") {
		const installed = isObject(before.lock.packages) ? before.lock.packages["node_modules/emdash"] : null;
		const specs = isObject(before.pkg.dependencies) ? before.pkg.dependencies : {};
		const current = isObject(installed) && typeof installed.version === "string" ? installed.version : specs.emdash;
		if (typeof current !== "string" || !isNewer(version, current)) {
			findings.push({ file: "package.json", rule: "version", message: `a core update must move emdash above the installed ${String(current)}, found ${version}` });
		}
	}
	return findings;
}

/**
 * A file of the commit the run started on.
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readHead(path) {
	return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8", maxBuffer: 256 * 1024 ** 2 }));
}

if (import.meta.main) {
	const { KIND: kind = "", PACKAGE: name = "", VERSION: version = "" } = process.env;
	report(
		"check-update-changes",
		updateFindings({
			kind,
			name,
			version,
			before: { pkg: readHead("package.json"), lock: readHead("package-lock.json") },
			after: { pkg: JSON.parse(readFileSync("package.json", "utf8")), lock: JSON.parse(readFileSync("package-lock.json", "utf8")) },
		}),
	);
}
