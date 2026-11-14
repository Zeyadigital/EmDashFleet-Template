// The checklist rule of scripts/check-pull-request.mjs (tracker APA-175).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTRACT_LINE, checklistFindings } from "./check-pull-request.mjs";

test("requires the ticked contract line only when compatibility_date changes", () => {
	const rules = (baseDate, headDate, messages) => checklistFindings({ baseDate, headDate, messages }).map((finding) => finding.rule);
	assert.deepEqual(rules("2026-11-01", "2026-11-01", ""), []);
	assert.deepEqual(rules("2026-11-01", "2026-11-10", `- [ ] ${CONTRACT_LINE}`), ["contract-tests"]);
	assert.deepEqual(rules("2026-11-01", "2026-11-10", `Summary\r\n- [x] ${CONTRACT_LINE}\r\n- [ ] When compatibility_date changes: the template checks ran on the new date`), []);
});

test("the finding names a commit message, not a pull request description", () => {
	const [finding] = checklistFindings({ baseDate: "2026-11-01", headDate: "2026-11-10", messages: "" });
	assert.match(finding.message, /in a commit message once they have$/);
	assert.doesNotMatch(finding.message, /pull request/);
});
