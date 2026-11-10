// The workflow guard of scripts/check-workflows.mjs on the template's own
// workflows and on the changes that would break Fleet's builds (tracker
// OAU-089).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { workflowFindings } from "./check-workflows.mjs";

const DIR = ".github/workflows";
const files = new Map(readdirSync(DIR).map((name) => [name, readFileSync(`${DIR}/${name}`, "utf8")]));

/** The rules the workflows break once `name` is changed by `edit`. */
function rulesAfter(name, edit) {
	const text = files.get(name) ?? "";
	const changed = edit(text);
	assert.notEqual(changed, text, "the edit changed nothing");
	return workflowFindings(new Map([...files, [name, changed]])).map((finding) => finding.rule);
}

test("passes the template's workflows", () => {
	assert.deepEqual(workflowFindings(files), []);
});

test("fails a push trigger, a missing input and an unconditioned template job", () => {
	assert.deepEqual(rulesAfter("fleet-build.yml", (text) => text.replace("on:\n", "on:\n  push:\n")), ["guard-trigger"]);
	assert.deepEqual(rulesAfter("fleet-update.yml", (text) => text.replace(/ {6}kind:\n(?: {8}.*\n)+/, "")), ["guard-inputs"]);
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace(/ {4}if: .*\n/, "")), ["guard-template-only"]);
});
