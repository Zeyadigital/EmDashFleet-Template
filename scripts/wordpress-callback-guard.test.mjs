// Tests of src/utils/wordpress-callback-guard.ts (security audit of
// 2026-11-21, Template v13): a WordPress authorization callback is served only
// to a browser an authorised import probe marked, and the mark is cleared.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTHORIZE_COOKIE, AUTHORIZE_SECONDS, refuseWordPressCallback, withWordPressAuthorizeCookie } from "../src/utils/wordpress-callback-guard.ts";

const site = "https://example.test";
const callback = `${site}/_emdash/api/import/wordpress-plugin/callback?site_url=https%3A%2F%2Fwp.example&user_login=a&password=b`;

test("refuses a callback without the authorization cookie, in every path form routing accepts", () => {
	for (const path of ["/_emdash/api/import/wordpress-plugin/callback", "/_emdash/api/import/wordpress-plugin/callback/", "/_emdash/api/import/wordpress-plugin/%63allback", "/_emdash/api/import//wordpress-plugin/Callback"]) {
		const answer = refuseWordPressCallback(new Request(`${site}${path}?site_url=x&user_login=a&password=b`));
		assert.equal(answer?.status, 303, path);
		assert.equal(answer?.headers.get("location"), "/_emdash/admin/import/wordpress?error=auth_rejected");
		assert.equal(answer?.headers.get("cache-control"), "no-store");
	}
});

test("serves a callback that carries the cookie, and other routes", () => {
	assert.equal(refuseWordPressCallback(new Request(callback, { headers: { cookie: `other=1; ${AUTHORIZE_COOKIE}=1` } })), null);
	assert.equal(refuseWordPressCallback(new Request(`${site}/_emdash/api/import/wordpress-plugin/analyze`, { method: "POST" })), null);
	assert.equal(refuseWordPressCallback(new Request(`${site}/posts/callback`)), null);
});

test("an authorised probe sets the cookie on the callback path, a refused probe does not", () => {
	const probe = () => new Request(`${site}/_emdash/api/import/probe`, { method: "POST" });
	for (const status of [200, 400, 500]) {
		const cookie = withWordPressAuthorizeCookie(probe(), new Response("{}", { status })).headers.get("set-cookie");
		assert.equal(cookie, `${AUTHORIZE_COOKIE}=1; Path=/_emdash/api/import/wordpress-plugin/; Max-Age=${AUTHORIZE_SECONDS}; HttpOnly; SameSite=Lax; Secure`, String(status));
	}
	for (const status of [401, 403]) {
		assert.equal(withWordPressAuthorizeCookie(probe(), new Response("{}", { status })).headers.get("set-cookie"), null, String(status));
	}
	assert.equal(withWordPressAuthorizeCookie(new Request(`${site}/_emdash/api/import/probe`), new Response("{}")).headers.get("set-cookie"), null);
});

test("a served callback clears the cookie and keeps the answer", () => {
	const answer = withWordPressAuthorizeCookie(new Request(callback), new Response(null, { status: 302, headers: { location: "/x", "set-cookie": "emdash_wp_auth=y; Path=/_emdash/" } }));
	assert.equal(answer.status, 302);
	assert.equal(answer.headers.get("location"), "/x");
	assert.deepEqual(answer.headers.getSetCookie(), ["emdash_wp_auth=y; Path=/_emdash/", `${AUTHORIZE_COOKIE}=; Path=/_emdash/api/import/wordpress-plugin/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`]);
});

test("leaves every other response untouched", () => {
	const response = new Response("ok");
	assert.equal(withWordPressAuthorizeCookie(new Request(`${site}/`), response), response);
});
