// Tests of scripts/check-pins.mjs (tracker APC-005): a range, a tag, a missing
// Node.js pin and a missing save-exact fail; the manifests of this repository pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { checkLockfile, checkManifest, checkRuntime } from "./check-pins.mjs";

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

test("fails an override that is not one exact version and a link that leaves the repository", () => {
	for (const value of ["^1.0.0", "github:a/b", "npm:other@1.0.0", "https://example.invalid/x.tgz", { ".": "1.0.0", child: "latest" }]) {
		assert.deepEqual(rules(checkManifest("package.json", manifest({ overrides: { a: value } }))), ["exact-version"], JSON.stringify(value));
	}
	assert.deepEqual(checkManifest("package.json", manifest({ dependencies: { a: "1.0.0" }, overrides: { a: "$a", b: "2.0.0", c: { ".": "3.0.0", d: "4.0.0" } } })), []);
	for (const link of ["file:a/../../x", "file:a/..", "file:.."]) {
		assert.deepEqual(rules(checkManifest("package.json", manifest({ dependencies: { local: link } }))), ["exact-version"], link);
	}
});

test("fails resolutions that are not exact and a bundled-dependencies field, and passes an empty one", () => {
	assert.deepEqual(rules(checkManifest("package.json", manifest({ resolutions: { a: "^1.0.0" } }))), ["exact-version"]);
	assert.deepEqual(checkManifest("package.json", manifest({ resolutions: { a: "1.0.0" } })), []);
	for (const field of ["bundleDependencies", "bundledDependencies"]) {
		for (const value of [["a"], true]) assert.deepEqual(rules(checkManifest("package.json", manifest({ dependencies: { a: "1.0.0" }, [field]: value }))), ["bundled-dependencies"], `${field} ${JSON.stringify(value)}`);
		for (const value of [[], false]) assert.deepEqual(checkManifest("package.json", manifest({ [field]: value })), [], field);
	}
});

test("fails a lockfile entry that is not resolved from the npm registry with an integrity", () => {
	const registry = "https://registry.npmjs.org/a/-/a-1.0.0.tgz";
	const lock = (entry) => JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "site" }, "node_modules/a": entry } });
	assert.deepEqual(checkLockfile("package-lock.json", lock({ version: "1.0.0", resolved: registry, integrity: "sha512-abc" })), []);
	for (const entry of [
		{ version: "1.0.0", resolved: "git+ssh://git@github.com/x/a.git#abc", integrity: "sha512-abc" },
		{ version: "1.0.0", resolved: "git+https://github.com/x/a.git#abc", integrity: "sha512-abc" },
		{ version: "1.0.0", resolved: "file:../a", integrity: "sha512-abc" },
		{ version: "1.0.0", resolved: "http://registry.npmjs.org/a/-/a-1.0.0.tgz", integrity: "sha512-abc" },
		{ version: "1.0.0", resolved: "https://registry.npmjs.org.example.invalid/a/-/a-1.0.0.tgz", integrity: "sha512-abc" },
		{ version: "1.0.0", resolved: "https://example.invalid/a.tgz", integrity: "sha512-abc" },
		{ version: "1.0.0", integrity: "sha512-abc" },
		{ version: "1.0.0", resolved: registry },
		{ version: "1.0.0", resolved: registry, integrity: "sha1-abc" },
		{ version: "1.0.0", resolved: registry, integrity: "sha512-abc", inBundle: true },
		{ resolved: "../a", link: true },
	]) {
		const findings = checkLockfile("package-lock.json", lock(entry));
		assert.deepEqual(rules(findings), ["lockfile-source"], JSON.stringify(entry));
		assert.match(findings[0]?.message ?? "", /^node_modules\/a /);
	}
	assert.deepEqual(checkLockfile("package-lock.json", JSON.stringify({ lockfileVersion: 3 })), []);
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
	assert.deepEqual(rules(checkRuntime({ ...ok, npmrc: "save-exact=false\n" })), ["save-exact", "npmrc"]);
	for (const extra of ["registry=https://example.invalid/", "@scope:registry=https://example.invalid/", "ignore-scripts=false", "allow-git=all"]) {
		assert.deepEqual(rules(checkRuntime({ ...ok, npmrc: `save-exact=true\n${extra}\n` })), ["npmrc"], extra);
	}
	assert.deepEqual(checkRuntime({ ...ok, npmrc: "# comment\nsave-exact=true\n\n" }), []);
});

test("the manifests, .nvmrc and .npmrc of this repository pass", () => {
	const result = spawnSync(process.execPath, ["scripts/check-pins.mjs"], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /check-pins: PASS/);
});
