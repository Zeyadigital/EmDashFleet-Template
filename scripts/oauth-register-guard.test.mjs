// Tests of src/utils/oauth-register-guard.ts (security audit of 2026-11-21,
// Template S2): an anonymous OAuth client registration over a size cap is
// refused, Fleet's own registration and every other request are served, and a
// served request still carries its whole body.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_BODY_BYTES,
	MAX_CLIENT_NAME,
	MAX_REDIRECT_URI,
	MAX_REDIRECT_URIS,
	MAX_SCOPE,
	refuseOversizedRegistration,
} from "../src/utils/oauth-register-guard.ts";

const url = "https://example.test/_emdash/api/oauth/register";

// The body of the site admin connection of app plan D21 (EmDashFleet-App,
// packages/shared/src/emdash-oauth.ts, registrationRequest).
const fleetBody = {
	redirect_uris: ["https://app.emdashfleet.com/connect/emdash/callback"],
	client_name: "EmDash Fleet",
	scope: "admin",
	token_endpoint_auth_method: "none",
};

const register = (body, init = {}) =>
	new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), ...init });

test("serves Fleet's own registration, anonymously, and leaves its body readable", async () => {
	const request = register(fleetBody);
	assert.ok(JSON.stringify(fleetBody).length < 300);
	assert.equal(await refuseOversizedRegistration(request), null);
	assert.deepEqual(await request.json(), fleetBody);
});

test("serves a registration at every cap", async () => {
	const body = {
		redirect_uris: Array.from({ length: MAX_REDIRECT_URIS }, () => `https://example.test/${"a".repeat(MAX_REDIRECT_URI - 21)}`),
		client_name: "n".repeat(MAX_CLIENT_NAME),
		scope: "s".repeat(MAX_SCOPE),
	};
	assert.ok(body.redirect_uris.every((uri) => uri.length === MAX_REDIRECT_URI));
	// Five 2,048-character URIs do not fit the 4,096-byte body, so one at a time.
	assert.equal(await refuseOversizedRegistration(register({ ...body, redirect_uris: body.redirect_uris.slice(0, 1) })), null);
	assert.equal(await refuseOversizedRegistration(register({ ...body, redirect_uris: Array.from({ length: MAX_REDIRECT_URIS }, () => "https://a.test/cb") })), null);
});

test("refuses a body that declares more than 4,096 bytes with 413, without reading it", async () => {
	const request = register(fleetBody, { headers: { "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) } });
	const answer = await refuseOversizedRegistration(request);
	assert.equal(answer?.status, 413);
	assert.equal(answer?.headers.get("cache-control"), "no-store");
	assert.equal((await answer.json()).error, "invalid_client_metadata");
});

test("refuses a streamed body over 4,096 bytes with 413 and stops reading it", async () => {
	let pulls = 0;
	const stream = new ReadableStream({
		pull(controller) {
			pulls += 1;
			controller.enqueue(new Uint8Array(1024).fill(0x20));
		},
	});
	const request = new Request(url, { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" } });
	assert.equal(request.headers.get("content-length"), null);
	const answer = await refuseOversizedRegistration(request);
	assert.equal(answer?.status, 413);
	assert.ok(pulls <= 8, `read ${pulls} chunks`);
});

test("refuses a body of exactly 4,097 bytes and serves one of exactly 4,096", async () => {
	const json = '{"redirect_uris":["https://a.test/cb"]}';
	const pad = (size) => json + " ".repeat(size - json.length);
	assert.equal(pad(MAX_BODY_BYTES).length, MAX_BODY_BYTES);
	assert.equal(await refuseOversizedRegistration(register(pad(MAX_BODY_BYTES))), null);
	assert.equal((await refuseOversizedRegistration(register(pad(MAX_BODY_BYTES + 1))))?.status, 413);
});

test("refuses a client name over 200 characters, more than 5 redirect URIs, a redirect URI over 2,048 characters and a scope over 512 characters with 400", async () => {
	const over = [
		{ ...fleetBody, client_name: "n".repeat(MAX_CLIENT_NAME + 1) },
		{ ...fleetBody, redirect_uris: Array.from({ length: MAX_REDIRECT_URIS + 1 }, () => "https://a.test/cb") },
		{ ...fleetBody, redirect_uris: [`https://a.test/${"a".repeat(MAX_REDIRECT_URI)}`] },
		{ ...fleetBody, scope: "s".repeat(MAX_SCOPE + 1) },
		{ ...fleetBody, scope: Array.from({ length: 200 }, () => "mcp:tools") },
	];
	for (const body of over) {
		const answer = await refuseOversizedRegistration(register(body));
		assert.equal(answer?.status, 400, JSON.stringify(body).slice(0, 60));
		assert.equal((await answer.json()).error, "invalid_client_metadata");
	}
});

test("refuses in every path form routing accepts", async () => {
	for (const path of ["/_emdash/api/oauth/register", "/_emdash/api/oauth/register/", "/_emdash/api/oauth/%72egister", "/_emdash//api/OAuth/register"]) {
		const request = new Request(`https://example.test${path}`, { method: "POST", body: JSON.stringify({ ...fleetBody, client_name: "n".repeat(MAX_CLIENT_NAME + 1) }) });
		assert.equal((await refuseOversizedRegistration(request))?.status, 400, path);
	}
});

test("serves other methods, other paths, and bodies EmDash answers itself", async () => {
	const huge = JSON.stringify({ ...fleetBody, client_name: "n".repeat(MAX_BODY_BYTES * 2) });
	assert.equal(await refuseOversizedRegistration(new Request(url, { method: "OPTIONS" })), null);
	assert.equal(await refuseOversizedRegistration(new Request(url)), null);
	assert.equal(await refuseOversizedRegistration(new Request("https://example.test/_emdash/api/oauth/token", { method: "POST", body: huge })), null);
	assert.equal(await refuseOversizedRegistration(new Request("https://example.test/_emdash/api/oauth/register/x", { method: "POST", body: huge })), null);
	assert.equal(await refuseOversizedRegistration(register("not json")), null);
	assert.equal(await refuseOversizedRegistration(register("[1,2]")), null);
	assert.equal(await refuseOversizedRegistration(new Request(url, { method: "POST" })), null);
});
