// Tests of src/utils/reading-time.ts (security audit of 2026-11-21, Template
// h32): a stored Portable Text value with a null or non-object block or child,
// which EmDash accepts on write, counts as no text instead of throwing while a
// post card or post page renders.
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractText, getReadingTime } from "../src/utils/reading-time.ts";

test("skips null and non-object blocks and children", () => {
	const content = [
		null,
		"text",
		{ _type: "block", children: [null, 7, { _type: "span", text: "one" }, { _type: "span" }, { _type: "span", text: "two" }] },
		{ _type: "block", children: null },
	];
	assert.equal(extractText(content), "onetwo");
	assert.equal(getReadingTime(content), 1);
});

test("counts the words of plain blocks", () => {
	const words = Array.from({ length: 401 }, () => "word").join(" ");
	assert.equal(getReadingTime([{ _type: "block", children: [{ _type: "span", text: words }] }]), 3);
	assert.equal(getReadingTime(undefined), 1);
});
