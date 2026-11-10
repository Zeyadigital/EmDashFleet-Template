// The checklist rule of the template's pull requests (tracker APA-175; app
// plan, Sites (template)): a pull request that changes compatibility_date in
// wrangler.jsonc fails until its description ticks the line of
// .github/pull_request_template.md stating that the nightly contract tests
// passed, because the template raises that date only once those tests pass on
// it. template-checks.yml runs it with the description in PR_BODY on the
// merge commit of the pull request, whose first parent is the base branch, and
// runs it again when the description is edited. wrangler.jsonc is read with
// Wrangler's own reader. A base without wrangler.jsonc has no date to change, so
// the pull request that adds the file passes whatever its description says.
//
// Usage: PR_BODY=<description> node scripts/check-pull-request.mjs [base revision, default HEAD^1]
// https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { experimental_readRawConfig } from "wrangler";
import { report } from "./lib/report.mjs";

export const CONTRACT_LINE = "The nightly contract tests passed on this change";

/**
 * The findings of one pull request.
 * @param {{ baseDate: unknown, headDate: unknown, body: string }} change the compatibility_date on both sides and the description
 * @returns {import("./lib/report.mjs").Finding[]}
 */
export function checklistFindings({ baseDate, headDate, body }) {
	if (baseDate === headDate) return [];
	const ticked = body.split(/\r?\n/).some((line) => /^[-*] \[[xX]\] (.*)$/.exec(line.trim())?.[1]?.trim() === CONTRACT_LINE);
	if (ticked) return [];
	return [{ file: "wrangler.jsonc", rule: "contract-tests", message: `compatibility_date changes from ${String(baseDate)} to ${String(headDate)}; tick "${CONTRACT_LINE}" in the description once they have` }];
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
			const findings = checklistFindings({ baseDate: compatibilityDate(basePath), headDate: compatibilityDate(resolve("wrangler.jsonc")), body: process.env.PR_BODY ?? "" });
			report("check-pull-request", findings);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
