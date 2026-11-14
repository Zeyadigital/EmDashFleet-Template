// The workflow guard of the template (tracker OAU-089, APA-172; app plan,
// Build and deploy (Workflow files in every site repository) and Testing).
// Every YAML file under .github/workflows and every action.yml under
// .github/actions/<name>/ follows the rules of scripts/lint-workflows.ts
// --template of Zeyadigital/EmDashFleet-App (tracker APC-004), repeated here
// because every site repository copies this template and cannot reach Fleet's
// code: a file that parses (block scalars included); no YAML anchor, alias,
// merge key or duplicate key; every `uses:` pinned to a 40-character commit
// SHA or a local action under ./.github/actions/; no `${{` inside `run:` or
// the `script:` of actions/github-script, so event values reach a shell only
// through `env:`; and no trigger that runs with secrets on events outsiders
// can cause. On top of that, fleet-build.yml and fleet-update.yml must keep
// exactly the trigger workflow_dispatch, the run-name Fleet matches runs by,
// `permissions: contents: read`, no `secrets` reference and their required
// string inputs, and every job of template-checks.yml must carry the
// repository condition of HR-119, so it never runs in a site repository, and
// must run gitleaks (APB-001): a release archive of a pinned version, checked
// against its SHA-256, over the commits of the push or pull request.
//
// Usage: node scripts/check-workflows.mjs
// https://docs.github.com/en/actions/reference/security/secure-use
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isMap, isNode, isPair, isScalar, LineCounter, parseDocument, visit } from "yaml";
import { report } from "./lib/report.mjs";

const WORKFLOWS_DIR = ".github/workflows";
const ACTIONS_DIR = ".github/actions";
const FULL_SHA = /^[0-9a-f]{40}$/;
const FORBIDDEN_TRIGGERS = new Set(["pull_request_target", "workflow_run", "issue_comment", "repository_dispatch"]);
const TEMPLATE_CONDITION = "github.repository == 'Zeyadigital/EmDashFleet-Template'";
const GITLEAKS_STEP = "gitleaks";

/** The required string inputs and the run-name of each build workflow, which Fleet dispatches and finds its runs by. */
const BUILD_WORKFLOWS = {
	"fleet-build.yml": { runName: "fleet-build ${{ inputs.job_id }}", inputs: ["commit_sha", "job_id"] },
	"fleet-update.yml": { runName: "fleet-update ${{ inputs.job_id }}", inputs: ["job_id", "kind", "package", "version"] },
};

/** @typedef {import("./lib/report.mjs").Finding} Finding */

/** @param {unknown} node */
function scalarText(node) {
	return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

/** @param {unknown} value */
function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The trigger names of a workflow's `on:` value: a string, a list or a map.
 * @param {unknown} on
 * @returns {string[]}
 */
function triggers(on) {
	if (typeof on === "string") return [on];
	if (Array.isArray(on)) return on.filter((name) => typeof name === "string");
	return isObject(on) ? Object.keys(on) : [];
}

/**
 * The findings of the rules every workflow follows.
 * @param {string} file
 * @param {string} text
 * @returns {{ findings: Finding[], workflow: unknown }} the workflow as plain values, or null when it does not parse
 */
export function lintWorkflow(file, text) {
	/** @type {Finding[]} */
	const findings = [];
	const lineCounter = new LineCounter();
	const doc = parseDocument(text, { uniqueKeys: true, merge: false, prettyErrors: false, lineCounter });
	/** @param {unknown} node */
	const lineOf = (node) => {
		const range = isNode(node) ? node.range : isPair(node) && isScalar(node.key) ? node.key.range : undefined;
		return range ? lineCounter.linePos(range[0]).line : undefined;
	};
	/** @type {(rule: string, message: string, line?: number) => void} */
	const fail = (rule, message, line) => findings.push({ file, line, rule, message });
	/** @param {unknown} node */
	const failAnchor = (node) => {
		if (isNode(node) && "anchor" in node && typeof node.anchor === "string") fail("anchor", `anchor &${node.anchor}`, lineOf(node));
	};

	for (const error of doc.errors) {
		const line = lineCounter.linePos(error.pos[0]).line;
		if (error.code === "DUPLICATE_KEY") fail("duplicate-key", "a key appears twice in one map", line);
		else fail("parse", error.message.split("\n")[0] ?? error.code, line);
	}
	if (findings.some((finding) => finding.rule === "parse")) return { findings, workflow: null };

	visit(doc, {
		Alias(_, node) {
			fail("alias", `alias *${node.source}`, lineOf(node));
		},
		// The Map visitor below replaces Node for maps, so it reports their anchors itself.
		Node(_, node) {
			failAnchor(node);
		},
		Pair(_, pair) {
			const key = scalarText(pair.key);
			if (key === "<<") fail("merge-key", "merge key <<", lineOf(pair));
			if (key === "run" && scalarText(pair.value)?.includes("${{")) {
				fail("expression-in-run", "${{ inside run: (pass it through env:)", lineOf(pair.value));
			}
			const uses = key === "uses" ? scalarText(pair.value) : null;
			if (uses !== null) {
				const line = lineOf(pair.value);
				if (uses.startsWith("./")) {
					if (!uses.startsWith("./.github/actions/")) fail("local-action", `${uses} is outside ./.github/actions/`, line);
				} else if (!FULL_SHA.test(uses.split("@")[1] ?? "")) {
					fail("unpinned-action", `${uses} is not pinned to a 40-character commit SHA`, line);
				}
			}
		},
		Map(_, map) {
			failAnchor(map);
			// A step of actions/github-script: its script input is code too.
			const uses = map.items.find((item) => scalarText(item.key) === "uses");
			if (!scalarText(uses?.value)?.startsWith("actions/github-script@")) return;
			const withInputs = map.items.find((item) => scalarText(item.key) === "with")?.value;
			const script = isMap(withInputs) ? withInputs.items.find((item) => scalarText(item.key) === "script") : undefined;
			if (scalarText(script?.value)?.includes("${{")) {
				fail("expression-in-script", "${{ inside the script: input of actions/github-script", lineOf(script?.value));
			}
		},
	});

	const workflow = doc.toJS();
	for (const trigger of triggers(isObject(workflow) ? workflow.on : undefined)) {
		if (FORBIDDEN_TRIGGERS.has(trigger)) fail("forbidden-trigger", `trigger ${trigger}`);
	}
	return { findings, workflow };
}

/**
 * The findings of the guard on fleet-build.yml or fleet-update.yml.
 * @param {keyof typeof BUILD_WORKFLOWS} name
 * @param {string} text
 * @param {unknown} workflow the file as plain values
 * @returns {Finding[]}
 */
export function guardBuildWorkflow(name, text, workflow) {
	const file = `${WORKFLOWS_DIR}/${name}`;
	const spec = BUILD_WORKFLOWS[name];
	/** @type {Finding[]} */
	const findings = [];
	/** @type {(rule: string, message: string) => void} */
	const fail = (rule, message) => findings.push({ file, rule, message });
	if (!isObject(workflow)) return [{ file, rule: "guard", message: "the file is not a workflow" }];

	const on = triggers(workflow.on);
	if (on.length !== 1 || on[0] !== "workflow_dispatch") fail("guard-trigger", `the triggers must be exactly workflow_dispatch, found ${on.join(", ") || "none"}`);
	if (workflow["run-name"] !== spec.runName) fail("guard-run-name", `run-name must be "${spec.runName}"`);
	const permissions = workflow.permissions;
	if (!isObject(permissions) || Object.keys(permissions).length !== 1 || permissions.contents !== "read") {
		fail("guard-permissions", "permissions must be exactly contents: read");
	}
	for (const [job, body] of Object.entries(isObject(workflow.jobs) ? workflow.jobs : {})) {
		if (isObject(body) && "permissions" in body) fail("guard-permissions", `job ${job} sets its own permissions`);
	}
	if (/\bsecrets\./.test(text)) fail("guard-secrets", "the workflow references secrets");

	const dispatch = isObject(workflow.on) ? workflow.on.workflow_dispatch : null;
	const inputs = isObject(dispatch) && isObject(dispatch.inputs) ? dispatch.inputs : {};
	const names = Object.keys(inputs).toSorted();
	if (names.join(",") !== spec.inputs.join(",")) fail("guard-inputs", `the inputs must be exactly ${spec.inputs.join(", ")}, found ${names.join(", ") || "none"}`);
	for (const input of spec.inputs) {
		const definition = inputs[input];
		if (isObject(definition) && (definition.required !== true || definition.type !== "string")) {
			fail("guard-inputs", `input ${input} must be required: true and type: string`);
		}
	}
	return findings;
}

/**
 * The findings of the guard on template-checks.yml: every job carries the template's repository condition, and the
 * job that checks pushes and pull requests scans their commits with gitleaks from a release archive whose SHA-256 is checked.
 * @param {unknown} workflow
 * @returns {Finding[]}
 */
export function guardTemplateChecks(workflow) {
	const file = `${WORKFLOWS_DIR}/template-checks.yml`;
	const jobs = isObject(workflow) && isObject(workflow.jobs) ? Object.entries(workflow.jobs) : [];
	if (jobs.length === 0) return [{ file, rule: "guard", message: "the file has no jobs" }];
	/** @type {Finding[]} */
	const findings = jobs
		.filter(([, body]) => !isObject(body) || body.if !== TEMPLATE_CONDITION)
		.map(([job]) => ({ file, rule: "guard-template-only", message: `job ${job} must carry if: ${TEMPLATE_CONDITION}` }));
	/** @type {(message: string) => void} */
	const fail = (message) => findings.push({ file, rule: "guard-gitleaks", message });
	const steps = jobs.flatMap(([, body]) => (isObject(body) && Array.isArray(body.steps) ? body.steps : []));
	const gitleaks = steps.find((step) => isObject(step) && step.name === GITLEAKS_STEP);
	if (!isObject(gitleaks)) {
		fail(`a step named ${GITLEAKS_STEP} is missing`);
		return findings;
	}
	const env = isObject(gitleaks.env) ? gitleaks.env : {};
	const run = typeof gitleaks.run === "string" ? gitleaks.run : "";
	if (!/^\d+\.\d+\.\d+$/.test(String(env.GITLEAKS_VERSION ?? ""))) fail("GITLEAKS_VERSION must be one exact release version");
	if (!/^[0-9a-f]{64}$/.test(String(env.GITLEAKS_SHA256 ?? ""))) fail("GITLEAKS_SHA256 must be the SHA-256 of the release archive");
	if (!run.includes("sha256sum --check --strict")) fail("the archive must be checked against its SHA-256 before it is unpacked");
	if (!run.includes("git rev-list --quiet") || !run.includes("--log-opts=")) fail("gitleaks must scan the commit range of the push or pull request, after git rev-list proves that the range resolves");
	const checkout = steps.find((step) => isObject(step) && typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"));
	if (!isObject(checkout) || !isObject(checkout.with) || checkout.with["fetch-depth"] !== 0) fail("actions/checkout must fetch the full history (fetch-depth: 0) for the commit range");
	return findings;
}

/**
 * The findings of every workflow file and composite action of a repository.
 * @param {ReadonlyMap<string, string>} files the text of each file under .github/workflows, by file name
 * @param {ReadonlyMap<string, string>} [actions] the text of each .github/actions/<name>/action.yml, by repository path
 * @returns {Finding[]}
 */
export function workflowFindings(files, actions = new Map()) {
	/** @type {Finding[]} */
	const findings = [];
	for (const name of Object.keys(BUILD_WORKFLOWS)) {
		if (!files.has(name)) findings.push({ file: `${WORKFLOWS_DIR}/${name}`, rule: "guard", message: "the file is missing" });
	}
	for (const [name, text] of files) {
		const linted = lintWorkflow(`${WORKFLOWS_DIR}/${name}`, text);
		findings.push(...linted.findings);
		if (linted.workflow === null) continue;
		if (name === "fleet-build.yml" || name === "fleet-update.yml") findings.push(...guardBuildWorkflow(name, text, linted.workflow));
		if (name === "template-checks.yml") findings.push(...guardTemplateChecks(linted.workflow));
	}
	for (const [path, text] of actions) findings.push(...lintWorkflow(path, text).findings);
	return findings;
}

/**
 * The composite actions of a repository: .github/actions/<name>/action.yml or action.yaml.
 * @returns {Map<string, string>} their text, by repository path
 */
function readActions() {
	/** @type {Map<string, string>} */
	const actions = new Map();
	if (!existsSync(ACTIONS_DIR)) return actions;
	for (const entry of readdirSync(ACTIONS_DIR, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) continue;
		for (const name of ["action.yml", "action.yaml"]) {
			const path = `${ACTIONS_DIR}/${entry.name}/${name}`;
			if (existsSync(path)) actions.set(path, readFileSync(path, "utf8"));
		}
	}
	return actions;
}

if (import.meta.main) {
	const names = readdirSync(WORKFLOWS_DIR).filter((name) => /\.ya?ml$/.test(name));
	const files = new Map(names.toSorted().map((name) => [name, readFileSync(`${WORKFLOWS_DIR}/${name}`, "utf8")]));
	report("check-workflows", workflowFindings(files, readActions()));
}
