// Tests of scripts/check-update-changes.mjs (security audit of 2026-11-21,
// Template S5): an update that changes more of package.json than the named
// dependencies, brings a lockfile entry from outside registry.npmjs.org or
// without an integrity, changes the integrity of a version already locked, or
// moves emdash down fails; a plain core or plugin update passes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isNewer, updateFindings } from "./check-update-changes.mjs";

const registry = "https://registry.npmjs.org/";
const entry = (name, version, integrity) => ({ version, resolved: `${registry}${name}/-/${name.split("/").at(-1)}-${version}.tgz`, integrity });

/** package.json and package-lock.json of a site on emdash 1.5.0 and one plugin on 1.0.0. */
function tree() {
	return {
		pkg: {
			name: "site",
			scripts: { build: "astro build" },
			dependencies: { emdash: "1.5.0", "@emdash-cms/cloudflare": "1.5.0", "@emdash-cms/plugin-forms": "1.0.0", react: "19.3.1" },
			allowScripts: { workerd: false },
		},
		lock: {
			lockfileVersion: 3,
			packages: {
				"": { name: "site", dependencies: { emdash: "1.5.0" } },
				"node_modules/emdash": entry("emdash", "1.5.0", "sha512-emdash150"),
				"node_modules/emdash/node_modules/zod": entry("zod", "4.0.0", "sha512-zod400"),
				"node_modules/@emdash-cms/cloudflare": entry("@emdash-cms/cloudflare", "1.5.0", "sha512-cloudflare150"),
				"node_modules/@emdash-cms/plugin-forms": entry("@emdash-cms/plugin-forms", "1.0.0", "sha512-forms100"),
				"node_modules/react": entry("react", "19.3.1", "sha512-react1931"),
			},
		},
	};
}

/** The tree after a core update to `version`, which removes the EmDash entries and installs them again. */
function core(version = "1.6.0") {
	const before = tree();
	const after = tree();
	after.pkg.dependencies.emdash = version;
	after.pkg.dependencies["@emdash-cms/cloudflare"] = version;
	after.lock.packages["node_modules/emdash"] = entry("emdash", version, `sha512-emdash${version.replaceAll(".", "")}`);
	after.lock.packages["node_modules/@emdash-cms/cloudflare"] = entry("@emdash-cms/cloudflare", version, `sha512-cloudflare${version.replaceAll(".", "")}`);
	after.lock.packages["node_modules/emdash/node_modules/new-dep"] = entry("new-dep", "2.0.0", "sha512-newdep200");
	return { kind: "core", name: "emdash", version, before, after };
}

/** The tree after an update of the plugin to 1.1.0. */
function plugin() {
	const before = tree();
	const after = tree();
	after.pkg.dependencies["@emdash-cms/plugin-forms"] = "1.1.0";
	after.lock.packages["node_modules/@emdash-cms/plugin-forms"] = entry("@emdash-cms/plugin-forms", "1.1.0", "sha512-forms110");
	return { kind: "plugin", name: "@emdash-cms/plugin-forms", version: "1.1.0", before, after };
}

const rules = (update) => updateFindings(update).map((finding) => finding.rule);

test("passes a core update and a plugin update", () => {
	assert.deepEqual(updateFindings(core()), []);
	assert.deepEqual(updateFindings(plugin()), []);
});

test("passes a plugin that is new to the site, a bundled dependency and a package.json written in another key order", () => {
	const added = plugin();
	delete added.before.pkg.dependencies["@emdash-cms/plugin-forms"];
	delete added.before.lock.packages["node_modules/@emdash-cms/plugin-forms"];
	assert.deepEqual(updateFindings(added), []);
	const bundled = plugin();
	bundled.after.lock.packages["node_modules/@emdash-cms/plugin-forms/node_modules/inner"] = { version: "1.0.0", inBundle: true };
	assert.deepEqual(updateFindings(bundled), []);
	const reordered = core();
	reordered.after.pkg = Object.fromEntries(Object.entries(reordered.after.pkg).reverse());
	assert.deepEqual(updateFindings(reordered), []);
});

test("passes the repository's own package.json and lockfile unchanged", () => {
	const read = (path) => JSON.parse(readFileSync(path, "utf8"));
	const same = { pkg: read("package.json"), lock: read("package-lock.json") };
	assert.deepEqual(updateFindings({ kind: "plugin", name: "react", version: same.pkg.dependencies.react, before: same, after: structuredClone(same) }), []);
});

test("fails a change to package.json beyond the version of the named dependencies", () => {
	for (const mutate of [
		(pkg) => (pkg.scripts.postinstall = "node steal.js"),
		(pkg) => (pkg.scripts.build = "astro build && node steal.js"),
		(pkg) => (pkg.overrides = { react: "0.0.1" }),
		(pkg) => (pkg.allowScripts.workerd = true),
		(pkg) => (pkg.packageManager = "npm@1.0.0"),
		(pkg) => (pkg.engines = { node: "1" }),
		(pkg) => (pkg.workspaces = ["evil"]),
		(pkg) => (pkg.dependencies.react = "0.0.1"),
		(pkg) => (pkg.devDependencies = { evil: "1.0.0" }),
		(pkg) => (pkg.peerDependencies = { emdash: "1.6.0" }),
	]) {
		const update = core();
		mutate(update.after.pkg);
		assert.deepEqual(rules(update), ["package-json"], mutate.toString());
	}
});

test("fails a named dependency that is not at exactly the version of the update", () => {
	for (const spec of ["^1.6.0", "1.6.1", "latest", "git+https://example.test/emdash.git"]) {
		const update = core();
		update.after.pkg.dependencies.emdash = spec;
		assert.deepEqual(rules(update), ["package-json"], spec);
	}
	const half = core();
	half.after.pkg.dependencies["@emdash-cms/cloudflare"] = "1.5.0";
	assert.deepEqual(rules(half), ["package-json"]);
	const removed = plugin();
	delete removed.after.pkg.dependencies["@emdash-cms/plugin-forms"];
	assert.ok(rules(removed).includes("package-json"));
});

test("fails a lockfile that is not version 3 or that does not install the named packages", () => {
	const old = core();
	old.after.lock.lockfileVersion = 2;
	assert.deepEqual(rules(old), ["lockfile"]);
	const before = core();
	before.before.lock.lockfileVersion = 1;
	assert.deepEqual(rules(before), ["lockfile"]);
	const stale = core();
	stale.after.lock.packages["node_modules/emdash"] = entry("emdash", "1.5.0", "sha512-emdash150");
	assert.deepEqual(rules(stale), ["lockfile"]);
	const none = core();
	delete none.after.lock.packages;
	assert.deepEqual(rules(none), ["lockfile"]);
});

test("fails a changed or added lockfile entry from outside the npm registry, without an integrity, or that is a link", () => {
	for (const bad of [
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: "https://evil.example/evil-1.0.0.tgz" },
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: "https://registry.npmjs.org.evil.example/evil/-/evil-1.0.0.tgz" },
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: "https://registry.npmjs.org@evil.example/evil/-/evil-1.0.0.tgz" },
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: "http://registry.npmjs.org/evil/-/evil-1.0.0.tgz" },
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: "git+ssh://git@github.com/evil/evil.git#abc" },
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: "file:../evil" },
		{ ...entry("evil", "1.0.0", "sha512-evil"), resolved: undefined },
		{ ...entry("evil", "1.0.0", "sha512-evil"), integrity: undefined },
		{ ...entry("evil", "1.0.0", "sha512-evil"), integrity: "sha1-evil" },
		{ resolved: "../evil", link: true },
	]) {
		const update = core();
		update.after.lock.packages["node_modules/evil"] = bad;
		assert.deepEqual(rules(update), ["registry"], JSON.stringify(bad));
	}
	const changed = core();
	changed.after.lock.packages["node_modules/react"] = { ...entry("react", "19.3.1", "sha512-react1931"), resolved: "https://evil.example/react.tgz" };
	assert.deepEqual(rules(changed), ["registry"]);
});

test("fails a name@version that keeps its number and changes its integrity", () => {
	const nested = core();
	nested.after.lock.packages["node_modules/emdash/node_modules/zod"] = entry("zod", "4.0.0", "sha512-other");
	assert.deepEqual(rules(nested), ["integrity"]);
	const unrelated = core();
	unrelated.after.lock.packages["node_modules/react"] = entry("react", "19.3.1", "sha512-other");
	assert.deepEqual(rules(unrelated), ["integrity"]);
	const raised = core();
	raised.after.lock.packages["node_modules/emdash/node_modules/zod"] = entry("zod", "4.1.0", "sha512-zod410");
	assert.deepEqual(updateFindings(raised), []);
});

test("fails a core update that does not move emdash up", () => {
	for (const version of ["1.5.0", "1.4.9", "0.9.0"]) {
		assert.deepEqual(rules(core(version)), ["version"], version);
	}
	assert.deepEqual(updateFindings(core("1.10.0")), []);
});

test("fails a kind that is neither plugin nor core", () => {
	assert.deepEqual(rules({ ...plugin(), kind: "other" }), ["update"]);
});

test("compares exact versions by number, not by text", () => {
	assert.equal(isNewer("1.10.0", "1.9.9"), true);
	assert.equal(isNewer("2.0.0", "1.99.99"), true);
	assert.equal(isNewer("1.5.1", "1.5.0"), true);
	assert.equal(isNewer("1.5.0", "1.5.0"), false);
	assert.equal(isNewer("1.9.9", "1.10.0"), false);
	assert.equal(isNewer("1.5.0", "1.5.0-beta.1"), true);
	assert.equal(isNewer("1.5.0-beta.1", "1.5.0"), false);
	assert.equal(isNewer("1.5.x", "1.5.0"), false);
	assert.equal(isNewer("1.6.0", "^1.5.0"), false);
});
