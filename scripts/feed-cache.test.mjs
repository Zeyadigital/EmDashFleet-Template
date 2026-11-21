// Tests of src/utils/feed-cache.ts (security audit of 2026-11-21, Template
// h31): a feed request with a cookie, which may read EmDash edit-mode drafts,
// is never stored by a shared cache; one without keeps public caching.
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedCacheControl } from "../src/utils/feed-cache.ts";

test("keeps a cookie-carrying feed request out of shared caches", () => {
	const request = new Request("https://example.test/rss.xml", { headers: { cookie: "emdash-edit-mode=true" } });
	assert.equal(feedCacheControl(request), "private, no-store");
});

test("caches a feed request without cookies publicly for an hour", () => {
	assert.equal(feedCacheControl(new Request("https://example.test/rss.xml")), "public, max-age=3600");
});
