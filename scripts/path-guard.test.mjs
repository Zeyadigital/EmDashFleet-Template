// Tests of src/utils/path-guard.ts (security audit of 2026-11-21, Template
// h30 and v11): a path longer than 1,024 characters and an EmDash route whose
// path carries an encoded backslash are refused, every other request is served.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PATH_LENGTH, refusePath } from "../src/utils/path-guard.ts";

test("refuses an EmDash route whose path carries %5C in either case", async () => {
	for (const path of ["/_emdash/api/content/posts/a%5Croom", "/_emdash/api/content/posts/..%5c..%5Cauth%5Cx", "/_emdash/api/content/posts/..%5C..%5Cmedia%5Cfile%5Cx"]) {
		const answer = refusePath(new Request(`https://example.test${path}`, { method: "DELETE" }));
		assert.equal(answer?.status, 400, path);
		assert.equal(answer?.headers.get("cache-control"), "no-store");
	}
});

test("serves EmDash routes without %5C and pages outside EmDash", () => {
	for (const path of ["/_emdash/api/content/posts/hello-world", "/_emdash/api/media/file/abc%20def", "/posts/a%5Cb"]) {
		assert.equal(refusePath(new Request(`https://example.test${path}`)), null, path);
	}
});

test("refuses a path longer than MAX_PATH_LENGTH, on a page or an EmDash route, and serves one at the limit", () => {
	for (const prefix of ["/", "/_emdash/api/content/posts/"]) {
		const atLimit = prefix + "a".repeat(MAX_PATH_LENGTH - prefix.length);
		assert.equal(refusePath(new Request(`https://example.test${atLimit}`)), null, prefix);
		const answer = refusePath(new Request(`https://example.test${atLimit}b`));
		assert.equal(answer?.status, 414, prefix);
		assert.equal(answer?.headers.get("cache-control"), "no-store");
	}
});

test("counts the percent-encoded form, so encoded characters cannot pass a longer path", () => {
	const encoded = "/" + "%C3%A9".repeat(Math.ceil(MAX_PATH_LENGTH / 6));
	assert.equal(refusePath(new Request(`https://example.test${encoded}`))?.status, 414);
});
