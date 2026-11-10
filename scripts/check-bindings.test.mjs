// The bindings check of scripts/check-bindings.mjs on the template's own files
// and on a renamed and an added binding (tracker APA-174).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { experimental_readRawConfig } from "wrangler";
import { bindingFindings, parseSiteBindings } from "./check-bindings.mjs";

const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
const bindings = parseSiteBindings(readFileSync("fleet-site-bindings.json", "utf8"));

/** @param {Record<string, unknown>} config */
const rules = (config) => bindingFindings(config, bindings).map((finding) => finding.rule);

test("passes the template's wrangler.jsonc", () => {
	assert.deepEqual(rules(rawConfig), []);
});

test("fails a renamed binding and a binding Fleet does not upload", () => {
	const renamed = structuredClone(rawConfig);
	renamed.kv_namespaces[0].binding = "SESSIONS";
	assert.deepEqual(rules(renamed), ["binding-names"]);
	assert.deepEqual(rules({ ...rawConfig, worker_loaders: [{ binding: "LOADER" }] }), ["unexpected-key"]);
});
