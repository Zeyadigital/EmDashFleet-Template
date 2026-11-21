// Tests of .github/dependabot.yml (security audit of 2026-11-21, Template S19):
// every entry proposes a release only 7 days after it is published.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const config = parse(readFileSync(".github/dependabot.yml", "utf8"));
const updates = config.updates;

test("has an npm and a github-actions entry", () => {
	assert.deepEqual(updates.map((entry) => entry["package-ecosystem"]).toSorted(), ["github-actions", "npm"]);
});

test("every entry waits 7 days after a release is published (cooldown default-days)", () => {
	for (const entry of updates) assert.equal(entry.cooldown?.["default-days"], 7, entry["package-ecosystem"]);
});
