// Fails on any dependency of any package.json that is not one exact version,
// on a .nvmrc that is not one exact Node.js version, on an engines.node that
// differs from it and on a .npmrc without save-exact (tracker APC-005; app
// plan, Operations, Versions: every package and the Node.js Active LTS line is
// pinned exactly). The same rules as scripts/check-pins.ts of
// Zeyadigital/EmDashFleet-App, which this repository cannot reach. Actions are
// pinned by commit SHA, which scripts/check-workflows.mjs checks. A `file:`
// link to a folder of this repository has no version to pin; a link that
// climbs out of it with `..` fails. Every `overrides` entry is one exact
// version or a `$name` reference to a direct dependency, and .npmrc holds
// save-exact=true and nothing else, so no registry, git or URL source can be
// added without failing (security audit of 2026-11-21, Template h03, h04, h20).
//
// Usage: node scripts/check-pins.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { report } from "./lib/report.mjs";

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCAL_LINK = /^file:(?![./])(?!(?:.*\/)?\.\.(?:\/|$))/;
const OVERRIDE_REFERENCE = /^\$[^\s$]+$/;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** @typedef {import("./lib/report.mjs").Finding} Finding */

/** @param {unknown} value */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The findings of one package.json.
 * @param {string} file
 * @param {string} text
 * @returns {Finding[]}
 */
export function checkManifest(file, text) {
	/** @type {Finding[]} */
	const findings = [];
	const manifest = JSON.parse(text);
	for (const field of DEPENDENCY_FIELDS) {
		const dependencies = isRecord(manifest) && isRecord(manifest[field]) ? manifest[field] : {};
		for (const [name, version] of Object.entries(dependencies)) {
			if (typeof version === "string" && (EXACT.test(version) || LOCAL_LINK.test(version))) continue;
			findings.push({ file, rule: "exact-version", message: `${field}.${name} is ${JSON.stringify(version)}, not one exact version` });
		}
	}
	if (isRecord(manifest) && manifest.overrides !== undefined) findings.push(...checkOverrides(file, "overrides", manifest.overrides));
	return findings;
}

/**
 * The findings of an `overrides` value: each string is one exact version or a `$name` reference, each object nests further overrides.
 * @param {string} file
 * @param {string} path
 * @param {unknown} value
 * @returns {Finding[]}
 */
function checkOverrides(file, path, value) {
	if (typeof value === "string" && (EXACT.test(value) || OVERRIDE_REFERENCE.test(value))) return [];
	if (isRecord(value)) return Object.entries(value).flatMap(([name, nested]) => checkOverrides(file, `${path}.${name}`, nested));
	return [{ file, rule: "exact-version", message: `${path} is ${JSON.stringify(value)}, not one exact version` }];
}

/**
 * The findings of .nvmrc, the root package.json's engines and .npmrc.
 * @param {{ nvmrc: string, rootManifest: string, npmrc: string }} files the text of each file ("" when missing)
 * @returns {Finding[]}
 */
export function checkRuntime({ nvmrc, rootManifest, npmrc }) {
	/** @type {Finding[]} */
	const findings = [];
	const node = nvmrc.trim();
	if (!/^\d+\.\d+\.\d+$/.test(node)) findings.push({ file: ".nvmrc", rule: "node-version", message: `${JSON.stringify(node)} is not one exact Node.js version` });
	const manifest = rootManifest === "" ? {} : JSON.parse(rootManifest);
	const engines = isRecord(manifest) && isRecord(manifest.engines) ? manifest.engines : {};
	for (const [name, version] of Object.entries(engines)) {
		if (typeof version !== "string" || !EXACT.test(version)) findings.push({ file: "package.json", rule: "engines", message: `engines.${name} must be one exact version` });
	}
	if (engines.node !== undefined && engines.node !== node) findings.push({ file: "package.json", rule: "engines", message: `engines.node must be ${node}, the version of .nvmrc` });
	if (!/^save-exact\s*=\s*true\s*$/m.test(npmrc)) findings.push({ file: ".npmrc", rule: "save-exact", message: "save-exact=true is missing" });
	for (const line of npmrc.split(/\r?\n/)) {
		const setting = line.trim();
		if (setting === "" || setting.startsWith("#") || setting.startsWith(";") || /^save-exact\s*=\s*true$/.test(setting)) continue;
		findings.push({ file: ".npmrc", rule: "npmrc", message: `${JSON.stringify(setting.split("=")[0]?.trim())} is not allowed: .npmrc holds save-exact=true only` });
	}
	return findings;
}

/** The text of a file, or "" when it does not exist. */
const readIfExists = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

if (import.meta.main) {
	const listed = spawnSync("git", ["ls-files", "-z", "--", "package.json", "**/package.json"], { encoding: "utf8" });
	if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
	const manifests = listed.stdout.split("\0").filter((path) => path !== "");
	report("check-pins", [
		...manifests.flatMap((path) => checkManifest(path, readFileSync(path, "utf8"))),
		...checkRuntime({ nvmrc: readIfExists(".nvmrc"), rootManifest: readIfExists("package.json"), npmrc: readIfExists(".npmrc") }),
	]);
}
