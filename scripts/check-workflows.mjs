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
// `permissions: contents: read`, no `secrets` reference, their required
// string inputs, the checkout, the artifact (name, paths, retention, hidden
// files) and the lines of the script that hold a run to the commit and the
// files Fleet expects (the build's commit_sha check, the update's path
// allowlist), and template-checks.yml must keep `permissions: contents:
// read` and its branch lists, every job of it must carry the repository
// condition of HR-119, so it never runs in a site repository, and it must run
// gitleaks (APB-001): a release archive of a pinned version, checked against
// its SHA-256, over the commits of the push or pull request.
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
/** The branches whose pushes and pull requests start template-checks.yml. */
const TEMPLATE_BRANCHES = { push: ["dev", "main"], pull_request: ["dev"] };

/**
 * What Fleet relies on in each build workflow it dispatches: the required string inputs, the run-name it finds its runs
 * by, the concurrency group (a fixed name, so no run cancels another), the checkout ref, the artifact name and the
 * paths it holds, and the lines of a `run:` script that keep a run to the commit and the files Fleet expects.
 */
const BUILD_WORKFLOWS = {
	"fleet-build.yml": {
		runName: "fleet-build ${{ inputs.job_id }}",
		inputs: ["commit_sha", "job_id"],
		concurrency: "fleet-build",
		checkoutRef: "${{ inputs.commit_sha }}",
		artifact: "fleet-bundle-${{ inputs.job_id }}",
		// The artifact's root is the repository: the bundle and the static output, nothing else.
		uploadPaths: ["fleet-bundle/", "dist/client/"],
		// The run builds the commit Fleet named, which must be the head of the dispatched branch.
		runLines: ['[[ "$COMMIT_SHA" == "$GITHUB_SHA" ]]'],
	},
	"fleet-update.yml": {
		runName: "fleet-update ${{ inputs.job_id }}",
		inputs: ["job_id", "kind", "package", "version"],
		concurrency: "fleet-update",
		checkoutRef: "${{ github.sha }}",
		artifact: "fleet-update-${{ inputs.job_id }}",
		uploadPaths: ["${{ runner.temp }}/fleet-update/"],
		// Only package.json and package-lock.json may change; any other path fails the run before it is stored.
		// The content of the two files is checked as well (scripts/check-update-changes.mjs), and a core update stops
		// on a lockfile that is not version 3 or that holds no EmDash package to replace.
		runLines: ['case "$path" in package.json|package-lock.json) ;; *)', "node scripts/check-update-changes.mjs", "if (lock.lockfileVersion !== 3)", "if (removed === 0)"],
	},
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
 * The trimmed, non-empty lines of a string.
 * @param {string} text
 * @returns {string[]}
 */
function lines(text) {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/**
 * Whether a workflow, as plain values, reaches the secrets context: a `secrets` key (`secrets: inherit`), a `${{ }}`
 * expression that names `secrets` in any spelling (`secrets.X`, `secrets['X']`, `toJSON(secrets)`), or an `if:`
 * condition that does without the braces. A comment is not part of the parsed workflow, so the comments that say a
 * file "holds no secret" are not findings.
 * @param {unknown} value
 * @param {string} [key] the key that holds `value`
 * @returns {boolean}
 */
function referencesSecrets(value, key = "") {
	if (typeof value === "string") {
		const inExpression = [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((expression) => /\bsecrets\b/.test(expression[1] ?? ""));
		return inExpression || (key === "if" && /\bsecrets\b/.test(value));
	}
	if (Array.isArray(value)) return value.some((item) => referencesSecrets(item, key));
	if (!isObject(value)) return false;
	return Object.entries(value).some(([name, nested]) => name === "secrets" || referencesSecrets(nested, name));
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
 * @param {unknown} workflow the file as plain values
 * @returns {Finding[]}
 */
export function guardBuildWorkflow(name, workflow) {
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
	if (referencesSecrets(workflow)) fail("guard-secrets", "the workflow references secrets");

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

	if (workflow.concurrency !== spec.concurrency) fail("guard-concurrency", `concurrency must be exactly ${spec.concurrency}, with no cancel-in-progress`);
	const steps = Object.values(isObject(workflow.jobs) ? workflow.jobs : {}).flatMap((body) => (isObject(body) && Array.isArray(body.steps) ? body.steps : []));
	const uses = (prefix) => steps.filter((step) => isObject(step) && typeof step.uses === "string" && step.uses.startsWith(prefix));
	const [checkout, ...otherCheckouts] = uses("actions/checkout@");
	if (otherCheckouts.length > 0 || !isObject(checkout) || !isObject(checkout.with) || checkout.with.ref !== spec.checkoutRef || checkout.with["persist-credentials"] !== false) {
		fail("guard-checkout", `one actions/checkout step with ref: ${spec.checkoutRef} and persist-credentials: false`);
	}
	const [upload, ...otherUploads] = uses("actions/upload-artifact@");
	const uploadPaths = isObject(upload) && isObject(upload.with) && typeof upload.with.path === "string" ? lines(upload.with.path) : [];
	if (
		otherUploads.length > 0 ||
		!isObject(upload) ||
		!isObject(upload.with) ||
		upload.with.name !== spec.artifact ||
		upload.with["retention-days"] !== 1 ||
		upload.with["if-no-files-found"] !== "error" ||
		upload.with["include-hidden-files"] !== true ||
		uploadPaths.join("\n") !== spec.uploadPaths.join("\n")
	) {
		fail(
			"guard-artifact",
			`one actions/upload-artifact step with name: ${spec.artifact}, path: ${spec.uploadPaths.join(" and ")}, retention-days: 1, if-no-files-found: error and include-hidden-files: true`,
		);
	}
	const scriptLines = steps.flatMap((step) => (isObject(step) && typeof step.run === "string" ? lines(step.run).filter((line) => !line.startsWith("#")) : []));
	for (const wanted of spec.runLines) {
		if (!scriptLines.some((line) => line.startsWith(wanted))) fail("guard-step", `a run: script must keep the line ${wanted}`);
	}
	return findings;
}

/**
 * The findings of the guard on template-checks.yml: the token stays read-only and the branch lists stay as they are,
 * every job carries the template's repository condition, and the job that checks pushes and pull requests scans their
 * commits with gitleaks from a release archive whose SHA-256 is checked.
 * @param {unknown} workflow
 * @returns {Finding[]}
 */
export function guardTemplateChecks(workflow) {
	const file = `${WORKFLOWS_DIR}/template-checks.yml`;
	const jobs = isObject(workflow) && isObject(workflow.jobs) ? Object.entries(workflow.jobs) : [];
	/** @type {Finding[]} */
	const findings = [];
	const on = isObject(workflow) && isObject(workflow.on) ? workflow.on : {};
	for (const [event, branches] of Object.entries(TEMPLATE_BRANCHES)) {
		const listed = isObject(on[event]) ? on[event].branches : null;
		if (!Array.isArray(listed) || listed.join(",") !== branches.join(",")) {
			findings.push({ file, rule: "guard-branches", message: `${event} must run for exactly the branches ${branches.join(", ")}` });
		}
	}
	const permissions = isObject(workflow) ? workflow.permissions : null;
	if (!isObject(permissions) || Object.keys(permissions).length !== 1 || permissions.contents !== "read") {
		findings.push({ file, rule: "guard-permissions", message: "permissions must be exactly contents: read" });
	}
	for (const [job, body] of jobs) {
		if (isObject(body) && "permissions" in body) findings.push({ file, rule: "guard-permissions", message: `job ${job} sets its own permissions` });
	}
	if (jobs.length === 0) return [...findings, { file, rule: "guard", message: "the file has no jobs" }];
	findings.push(
		...jobs
			.filter(([, body]) => !isObject(body) || body.if !== TEMPLATE_CONDITION)
			.map(([job]) => ({ file, rule: "guard-template-only", message: `job ${job} must carry if: ${TEMPLATE_CONDITION}` })),
	);
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
	if (!run.includes('--log-opts="--text -m ')) fail("gitleaks must render the commit range as text with merge diffs (--log-opts=\"--text -m ...\"), so a -diff attribute, an early NUL or a merge resolution hides nothing");
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
		if (name === "fleet-build.yml" || name === "fleet-update.yml") findings.push(...guardBuildWorkflow(name, linted.workflow));
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
