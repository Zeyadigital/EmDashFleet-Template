// Tests of astro.config.mjs (security audit of 2026-11-21, Template S1): the D1
// session of every request starts on the primary database, so a read replica
// that has not yet seen a revoked token or a disabled user is never consulted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync("astro.config.mjs", "utf8");

test("the D1 adapter starts every session on the primary database", () => {
	assert.match(config, /d1\(\{[^}]*session: "primary-first"/);
	assert.doesNotMatch(config, /session: "(auto|disabled)"/);
});
