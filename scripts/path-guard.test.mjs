// Tests of src/utils/path-guard.ts (security audit of 2026-11-21, Template
// h30): an EmDash route whose path carries an encoded backslash is refused,
// every other request is served.
import assert from "node:assert/strict";
import { test } from "node:test";
import { refuseEncodedBackslash } from "../src/utils/path-guard.ts";

test("refuses an EmDash route whose path carries %5C in either case", async () => {
	for (const path of ["/_emdash/api/content/posts/a%5Croom", "/_emdash/api/content/posts/..%5c..%5Cauth%5Cx", "/_emdash/api/content/posts/..%5C..%5Cmedia%5Cfile%5Cx"]) {
		const answer = refuseEncodedBackslash(new Request(`https://example.test${path}`, { method: "DELETE" }));
		assert.equal(answer?.status, 400, path);
		assert.equal(answer?.headers.get("cache-control"), "no-store");
	}
});

test("serves EmDash routes without %5C and pages outside EmDash", () => {
	for (const path of ["/_emdash/api/content/posts/hello-world", "/_emdash/api/media/file/abc%20def", "/posts/a%5Cb"]) {
		assert.equal(refuseEncodedBackslash(new Request(`https://example.test${path}`)), null, path);
	}
});
