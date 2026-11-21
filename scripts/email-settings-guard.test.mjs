// Tests of src/utils/email-settings-guard.ts (security audit of 2026-11-21,
// Template v16): a write to the email settings that carries a token is refused,
// the admin's cookie-authorised writes and every read are served.
import assert from "node:assert/strict";
import { test } from "node:test";
import { refuseTokenEmailSettings } from "../src/utils/email-settings-guard.ts";

const site = "https://example.test";
const bearer = { authorization: "Bearer ec_pat_dummy" };

test("refuses a token-authorised write to the email settings in every path form", async () => {
	for (const method of ["PUT", "POST", "PATCH", "DELETE"]) {
		for (const path of ["/_emdash/api/settings/email", "/_emdash/api/settings/email/", "/_emdash/api/settings/%65mail", "/_emdash//api/Settings/email"]) {
			const answer = refuseTokenEmailSettings(new Request(`${site}${path}`, { method, headers: bearer }));
			assert.equal(answer?.status, 403, `${method} ${path}`);
			assert.equal(answer?.headers.get("cache-control"), "no-store");
			assert.equal((await answer.json()).error.code, "FORBIDDEN");
		}
	}
});

test("serves reads, cookie-authorised writes and other settings routes", () => {
	assert.equal(refuseTokenEmailSettings(new Request(`${site}/_emdash/api/settings/email`, { headers: bearer })), null);
	assert.equal(refuseTokenEmailSettings(new Request(`${site}/_emdash/api/settings/email`, { method: "PUT", headers: { cookie: "astro-session=x" } })), null);
	assert.equal(refuseTokenEmailSettings(new Request(`${site}/_emdash/api/settings`, { method: "PUT", headers: bearer })), null);
});
