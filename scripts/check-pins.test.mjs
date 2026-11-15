// Tests of scripts/check-pins.mjs (tracker APC-005): a range, a tag, a missing
// Node.js pin and a missing save-exact fail; the manifests of this repository pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { checkManifest, checkRuntime } from "./check-pins.mjs";

const rules = (findings) => findings.map((finding) => finding.rule);
const manifest = (value) => JSON.stringify(value);

test("fails a range, a tag and a missing version in every dependency field", () => {
	for (const version of ["^1.2.3", "~1.2.3", "1.2", "latest", "*", ">=1.0.0", "../elsewhere", "file:../x"]) {
		assert.deepEqual(rules(checkManifest("package.json", manifest({ devDependencies: { vitest: version } }))), ["exact-version"], version);
	}
	for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
		assert.deepEqual(rules(checkManifest("package.json", manifest({ [field]: { a: "^1.0.0" } }))), ["exact-version"], field);
	}
});

test("passes exact versions, a pre-release and a link to a folder of the repository", () => {
	const dependencies = { astro: "7.4.9", rc: "1.0.0-rc.1", local: "file:plugins/local" };
	assert.deepEqual(checkManifest("package.json", manifest({ dependencies })), []);
});

test("requires an exact Node.js version in .nvmrc, matched by engines.node when present", () => {
	const ok = { nvmrc: "26.13.0\n", rootManifest: manifest({}), npmrc: "save-exact=true\n" };
	assert.deepEqual(checkRuntime(ok), []);
	assert.deepEqual(rules(checkRuntime({ ...ok, nvmrc: "26\n" })), ["node-version"]);
	assert.deepEqual(rules(checkRuntime({ ...ok, nvmrc: "" })), ["node-version"]);
	assert.deepEqual(checkRuntime({ ...ok, rootManifest: manifest({ engines: { node: "26.13.0", npm: "12.2.2" } }) }), []);
	assert.deepEqual(rules(checkRuntime({ ...ok, rootManifest: manifest({ engines: { node: "25.0.0" } }) })), ["engines"]);
	assert.deepEqual(rules(checkRuntime({ ...ok, rootManifest: manifest({ engines: { npm: "^12.0.0" } }) })), ["engines"]);
});

test("requires save-exact in .npmrc", () => {
	const ok = { nvmrc: "26.13.0\n", rootManifest: manifest({}), npmrc: "save-exact=true\n" };
	assert.deepEqual(rules(checkRuntime({ ...ok, npmrc: "" })), ["save-exact"]);
	assert.deepEqual(rules(checkRuntime({ ...ok, npmrc: "save-exact=false\n" })), ["save-exact"]);
});

test("the manifests, .nvmrc and .npmrc of this repository pass", () => {
	const result = spawnSync(process.execPath, ["scripts/check-pins.mjs"], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /check-pins: PASS/);
});
