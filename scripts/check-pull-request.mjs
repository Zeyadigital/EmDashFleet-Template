// The checklist rule of the template's changes (tracker APA-175; github_oauth_plan.md
// D22 (HR-162); app plan, Sites (template)): a change that raises compatibility_date
// in wrangler.jsonc fails until a line stating that the nightly contract tests passed is
// ticked (`- [x] The nightly contract tests passed on this change`) in the message of one
// of the commits between the base revision and HEAD, because the template raises that
// date only once those tests pass on it. There is no pull request template and no pull
// request description to read: a co-founder pushes alone (HR-162) and the line goes in
// the message of a commit of the push. template-checks.yml runs it on a push with the
// revision before the push as the base, and on the merge commit of a Dependabot pull
// request, whose first parent is the base branch. wrangler.jsonc is read with Wrangler's
// own reader. A base without wrangler.jsonc has no date to change, so the change that
// adds the file passes whatever its messages say.
//
// Usage: node scripts/check-pull-request.mjs [base revision, default HEAD^1]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { experimental_readRawConfig } from "wrangler";
import { report } from "./lib/report.mjs";

export const CONTRACT_LINE = "The nightly contract tests passed on this change";

/**
 * The findings of one change.
 * @param {{ baseDate: unknown, headDate: unknown, messages: string }} change the compatibility_date on both sides and the commit messages that describe it
 * @returns {import("./lib/report.mjs").Finding[]}
 */
export function checklistFindings({ baseDate, headDate, messages }) {
	if (baseDate === headDate) return [];
	const ticked = messages.split(/\r?\n/).some((line) => /^[-*] \[[xX]\] (.*)$/.exec(line.trim())?.[1]?.trim() === CONTRACT_LINE);
	if (ticked) return [];
	return [{ file: "wrangler.jsonc", rule: "contract-tests", message: `compatibility_date changes from ${String(baseDate)} to ${String(headDate)}; tick "${CONTRACT_LINE}" in a commit message once they have` }];
}

/**
 * The compatibility_date of a wrangler.jsonc on disk.
 * @param {string} path
 * @returns {unknown}
 */
function compatibilityDate(path) {
	const { rawConfig, configPath } = experimental_readRawConfig({ config: path });
	if (configPath !== path) throw new Error(`Wrangler read ${configPath} instead of ${path}`);
	return rawConfig.compatibility_date;
}

if (import.meta.main) {
	const base = process.argv[2] ?? "HEAD^1";
	const inBase = execFileSync("git", ["ls-tree", "--name-only", base, "--", "wrangler.jsonc"], { encoding: "utf8" }).trim() !== "";
	if (!inBase) report("check-pull-request", []);
	else {
		const dir = mkdtempSync(join(tmpdir(), "fleet-check-pull-request-"));
		try {
			const basePath = join(dir, "wrangler.jsonc");
			writeFileSync(basePath, execFileSync("git", ["show", `${base}:wrangler.jsonc`], { encoding: "utf8" }));
			const messages = execFileSync("git", ["log", "--format=%B", `${base}..HEAD`], { encoding: "utf8" });
			const findings = checklistFindings({ baseDate: compatibilityDate(basePath), headDate: compatibilityDate(resolve("wrangler.jsonc")), messages });
			report("check-pull-request", findings);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
