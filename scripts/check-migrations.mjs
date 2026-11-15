// Applies EmDash's migrations to a new, empty local D1 database and checks that
// exactly the migrations of the build ran (HR-118 A; app plan, Sites (template);
// tracker APA-173). `emdash migrate` reaches only remote D1, and Fleet's
// template checks hold no Cloudflare token, so the check runs the built site
// with `wrangler dev --local` on a new persistence directory and requests
// GET /_emdash/api/setup/status, which must answer 200; EmDash migrates the
// database on that first request. After the server stops, the names in
// _emdash_migrations must equal migrationSet.names of .emdash/migrations.json,
// the manifest the build writes: none pending and none unknown.
//
// Usage: npm run build && node scripts/check-migrations.mjs
// https://docs.emdashcms.com/reference/core-migrations/
// https://developers.cloudflare.com/workers/wrangler/commands/#dev
// https://developers.cloudflare.com/workers/wrangler/commands/#d1-execute
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { report } from "./lib/report.mjs";

const MANIFEST = ".emdash/migrations.json";
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;
const QUIET_ENV = { ...process.env, WRANGLER_SEND_METRICS: "false" };

/**
 * The findings of a comparison between the applied migrations and the manifest.
 * @param {readonly string[]} applied the names in _emdash_migrations
 * @param {readonly string[]} expected migrationSet.names of the manifest
 * @returns {import("./lib/report.mjs").Finding[]}
 */
export function migrationFindings(applied, expected) {
	const appliedSet = new Set(applied);
	const expectedSet = new Set(expected);
	return [
		...expected.filter((name) => !appliedSet.has(name)).map((name) => ({ file: MANIFEST, rule: "pending", message: `${name} did not run` })),
		...applied.filter((name) => !expectedSet.has(name)).map((name) => ({ file: MANIFEST, rule: "unknown", message: `${name} ran but is not in the manifest` })),
	];
}

/** A TCP port that was free a moment ago on 127.0.0.1. */
async function freePort() {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	server.close();
	if (address === null || typeof address === "string") throw new Error("no TCP port");
	return address.port;
}

/**
 * Runs the built site on an empty local database until setup/status answers.
 * @param {string} persistTo
 * @returns {Promise<number>} the status of the first answer
 */
async function startAndRequest(persistTo) {
	const port = await freePort();
	const args = [WRANGLER, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persistTo, "--show-interactive-dev-session=false"];
	// Its own process group, so stopping it also stops workerd.
	const child = spawn(process.execPath, args, { detached: true, env: QUIET_ENV, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	child.stderr.on("data", (chunk) => (output += chunk));
	const exited = once(child, "exit");
	const stop = async () => {
		if (child.exitCode !== null || child.pid === undefined) return;
		process.kill(-child.pid, "SIGTERM");
		const stopped = await Promise.race([exited.then(() => true), delay(STOP_TIMEOUT_MS, false)]);
		if (!stopped) process.kill(-child.pid, "SIGKILL");
	};
	try {
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (child.exitCode !== null) throw new Error(`wrangler dev exited with ${child.exitCode}:\n${output}`);
			const response = await fetch(`http://127.0.0.1:${port}/_emdash/api/setup/status`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
			if (response !== null) {
				await response.body?.cancel();
				return response.status;
			}
			await delay(1000);
		}
		throw new Error(`setup/status did not answer within ${READY_TIMEOUT_MS / 1000} s:\n${output}`);
	} finally {
		await stop();
	}
}

/**
 * The names in _emdash_migrations of the local database.
 * @param {string} persistTo
 * @returns {string[]}
 */
function appliedMigrations(persistTo) {
	const command = "SELECT name FROM _emdash_migrations ORDER BY name";
	const stdout = execFileSync(process.execPath, [WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", persistTo, "--json", "--command", command], {
		encoding: "utf8",
		env: QUIET_ENV,
	});
	const results = JSON.parse(stdout);
	if (!Array.isArray(results) || results.length !== 1 || !Array.isArray(results[0].results)) throw new Error(`unexpected wrangler d1 execute output: ${stdout}`);
	return results[0].results.map((row) => String(row.name));
}

if (import.meta.main) {
	if (!existsSync(MANIFEST)) throw new Error(`${MANIFEST} is missing: run npm run build first`);
	const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
	const expected = manifest?.migrationSet?.names;
	if (!Array.isArray(expected) || expected.length === 0) throw new Error(`${MANIFEST} has no migrationSet.names`);
	const persistTo = mkdtempSync(join(tmpdir(), "fleet-check-migrations-"));
	try {
		const status = await startAndRequest(persistTo);
		/** @type {import("./lib/report.mjs").Finding[]} */
		const findings = status === 200 ? [] : [{ file: "dist/server", rule: "setup-status", message: `GET /_emdash/api/setup/status answered ${status}` }];
		report("check-migrations", [...findings, ...migrationFindings(appliedMigrations(persistTo), expected)]);
	} finally {
		rmSync(persistTo, { recursive: true, force: true });
	}
}
