// The workflow guard of scripts/check-workflows.mjs on the template's own
// workflows and on the changes that would break Fleet's builds (tracker
// OAU-089).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { lintWorkflow, workflowFindings } from "./check-workflows.mjs";

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

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const workflow = (body) => `on: workflow_dispatch\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n${body}`;
const rulesOf = (text) => lintWorkflow("w.yml", text).findings.map((finding) => finding.rule);

test("fails a file that does not parse", () => {
	assert.ok(rulesOf("on: [\njobs: {").includes("parse"));
	assert.ok(rulesOf("on: workflow_dispatch\njobs:\n  j:\n   runs-on: x\n  k: y\n    z: 1\n").includes("parse"));
});

test("reads a block scalar in full and fails a ${{ expression inside run:", () => {
	const block = workflow(`      - run: |\n          echo one\n          echo "\${{ github.event.pull_request.title }}"\n`);
	assert.deepEqual(rulesOf(block), ["expression-in-run"]);
	assert.deepEqual(rulesOf(workflow(`      - run: >-\n          echo \${{ github.actor }}\n`)), ["expression-in-run"]);
	assert.deepEqual(rulesOf(workflow(`      - run: echo "\${{ github.sha }}"\n`)), ["expression-in-run"]);
	assert.deepEqual(rulesOf(workflow(`      - env:\n          TITLE: \${{ github.event.pull_request.title }}\n        run: |\n          echo "$TITLE"\n`)), []);
});

test("fails a ${{ expression inside the script of actions/github-script", () => {
	const step = (script) => workflow(`      - uses: actions/github-script@${SHA}\n        with:\n          script: |\n            ${script}\n`);
	assert.deepEqual(rulesOf(step("core.info('${{ github.actor }}')")), ["expression-in-script"]);
	assert.deepEqual(rulesOf(step("core.info('x')")), []);
});

test("fails an anchor, an alias, a merge key and a duplicate key", () => {
	assert.deepEqual(rulesOf("on: workflow_dispatch\nx: &a\n  k: 1\njobs: {}\n"), ["anchor"]);
	assert.deepEqual(rulesOf("on: workflow_dispatch\nx: &a 1\ny: *a\njobs: {}\n").toSorted(), ["alias", "anchor"]);
	assert.ok(rulesOf("on: workflow_dispatch\nx: &a\n  k: 1\ny:\n  <<: *a\njobs: {}\n").includes("merge-key"));
	assert.deepEqual(rulesOf("on: workflow_dispatch\non: push\njobs: {}\n"), ["duplicate-key"]);
});

test("fails an action that is not pinned to a commit SHA and a local action outside .github/actions", () => {
	assert.deepEqual(rulesOf(workflow("      - uses: actions/checkout@v4\n")), ["unpinned-action"]);
	assert.deepEqual(rulesOf(workflow("      - uses: actions/checkout\n")), ["unpinned-action"]);
	assert.deepEqual(rulesOf(workflow(`      - uses: actions/checkout@${SHA.slice(1)}\n`)), ["unpinned-action"]);
	assert.deepEqual(rulesOf(workflow("      - uses: ./local\n")), ["local-action"]);
	assert.deepEqual(rulesOf(workflow("      - uses: ./.github/actions/x\n")), []);
	assert.deepEqual(rulesOf(workflow(`      - uses: actions/checkout@${SHA} # v7.0.1\n`)), []);
});

test("fails the triggers that run with secrets on events outsiders can cause", () => {
	for (const trigger of ["pull_request_target", "workflow_run", "issue_comment", "repository_dispatch"]) {
		assert.deepEqual(rulesOf(`on:\n  ${trigger}:\njobs: {}\n`), ["forbidden-trigger"], trigger);
		assert.deepEqual(rulesOf(`on: [push, ${trigger}]\njobs: {}\n`), ["forbidden-trigger"], trigger);
	}
	assert.deepEqual(rulesOf("on:\n  pull_request:\njobs: {}\n"), []);
});

test("lints a composite action under .github/actions like a workflow", () => {
	const path = ".github/actions/setup/action.yml";
	const action = (step) => `name: setup\nruns:\n  using: composite\n  steps:\n${step}`;
	assert.deepEqual(workflowFindings(files, new Map([[path, action("    - uses: actions/checkout@v4\n")]])).map((finding) => finding.rule), ["unpinned-action"]);
	assert.deepEqual(workflowFindings(files, new Map([[path, action('    - run: echo "${{ inputs.x }}"\n      shell: bash\n')]])).map((finding) => finding.file), [path]);
	assert.deepEqual(workflowFindings(files, new Map([[path, action("    - run: echo ok\n      shell: bash\n")]])), []);
});

test("fails template-checks.yml without a pinned, verified gitleaks scan of the commits of a push or pull request", () => {
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace("name: gitleaks", "name: scan")), ["guard-gitleaks"]);
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace("GITLEAKS_VERSION: 8.30.1", "GITLEAKS_VERSION: latest")), ["guard-gitleaks"]);
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace(/GITLEAKS_SHA256: [0-9a-f]+/, "GITLEAKS_SHA256: abc")), ["guard-gitleaks"]);
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace(/ {10}echo "\$\{GITLEAKS_SHA256\}.*\n/, "")), ["guard-gitleaks"]);
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace(/ {10}git rev-list --quiet.*\n/, "")), ["guard-gitleaks"]);
	assert.deepEqual(rulesAfter("template-checks.yml", (text) => text.replace("fetch-depth: 0", "fetch-depth: 2")), ["guard-gitleaks"]);
});
