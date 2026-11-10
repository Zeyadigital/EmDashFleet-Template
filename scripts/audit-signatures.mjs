// Verifies the registry signatures and provenance attestations of the installed
// packages after `npm ci` (app plan, Security (Template supply chain); tracker
// APA-170, APA-173). The build fails when an @emdash-fleet/* package has an
// invalid or missing registry signature or no verified provenance attestation,
// and the job records a warning when emdash or an @emdash-cms/* package has
// one of those gaps, or when any other package has an invalid or missing
// signature. npm exits 1 whenever its lists are not empty, so the exit code is
// ignored and the JSON decides; output that is not npm's JSON fails the build.
//
// Usage: node scripts/audit-signatures.mjs
// https://docs.npmjs.com/cli/v12/commands/npm-audit
// https://docs.npmjs.com/generating-provenance-statements
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { report } from "./lib/report.mjs";

const LOCKFILE = "package-lock.json";

/**
 * @typedef {object} AuditEntry
 * @property {string} name
 * @property {string} version
 * @property {string} location
 * @property {string} [code]
 * @property {{ provenance?: unknown }} [attestations]
 */

/**
 * @typedef {object} Audit
 * @property {AuditEntry[]} invalid
 * @property {AuditEntry[]} missing
 * @property {AuditEntry[]} verified the packages whose attestations npm verified
 */

/** @typedef {{ location: string, name: string, version: string }} Installed */

/**
 * Fleet's own packages fail the build, EmDash's raise a warning, and any other package is not watched.
 * @param {string} name
 * @returns {"fail" | "warn" | null}
 */
function watch(name) {
	if (name.startsWith("@emdash-fleet/")) return "fail";
	if (name === "emdash" || name.startsWith("@emdash-cms/")) return "warn";
	return null;
}

/**
 * The installed packages of a package-lock.json, by their location under node_modules.
 * @param {string} text
 * @returns {Installed[]}
 */
export function installedPackages(text) {
	const packages = JSON.parse(text).packages ?? {};
	return Object.entries(packages)
		.filter(([location, entry]) => location.includes("node_modules/") && typeof entry.version === "string" && !entry.link)
		.map(([location, entry]) => ({ location, name: location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length), version: entry.version }));
}

/**
 * The failures and warnings of one audit.
 * @param {Audit} audit
 * @param {readonly Installed[]} installed
 * @returns {{ failures: import("./lib/report.mjs").Finding[], warnings: string[] }}
 */
export function signatureFindings(audit, installed) {
	/** @type {import("./lib/report.mjs").Finding[]} */
	const failures = [];
	/** @type {string[]} */
	const warnings = [];
	/** @type {(name: string, message: string, rule: string) => void} */
	const record = (name, message, rule) => {
		if (watch(name) === "fail") failures.push({ file: LOCKFILE, rule, message });
		else warnings.push(message);
	};
	for (const entry of audit.invalid) record(entry.name, `${entry.name}@${entry.version} (${entry.location}) has an invalid signature or attestation (${entry.code ?? "unknown code"})`, "invalid");
	for (const entry of audit.missing) record(entry.name, `${entry.name}@${entry.version} (${entry.location}) has no registry signature`, "missing");
	const attested = new Set(audit.verified.filter((entry) => entry.attestations?.provenance !== undefined).map((entry) => entry.location));
	for (const pkg of installed) {
		if (watch(pkg.name) !== null && !attested.has(pkg.location)) record(pkg.name, `${pkg.name}@${pkg.version} (${pkg.location}) has no verified provenance attestation`, "provenance");
	}
	return { failures, warnings };
}

/**
 * The parsed output of npm audit signatures, or an error when it is not npm's JSON.
 * @param {string} stdout
 * @returns {Audit}
 */
export function parseAudit(stdout) {
	const audit = JSON.parse(stdout);
	for (const list of ["invalid", "missing", "verified"]) {
		if (!Array.isArray(audit?.[list])) throw new Error(`npm audit signatures printed no ${list} list: ${stdout.slice(0, 500)}`);
	}
	return audit;
}

if (import.meta.main) {
	const result = spawnSync("npm", ["audit", "signatures", "--json", "--include-attestations"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.error) throw result.error;
	const { failures, warnings } = signatureFindings(parseAudit(result.stdout), installedPackages(readFileSync(LOCKFILE, "utf8")));
	// A workflow command: GitHub Actions shows each line as a warning on the job.
	for (const warning of warnings) console.log(`::warning file=${LOCKFILE}::${warning}`);
	report("audit-signatures", failures);
}
