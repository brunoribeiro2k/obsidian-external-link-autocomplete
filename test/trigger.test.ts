import { test } from "node:test";
import assert from "node:assert/strict";
import { findTrigger, isTableRow } from "../src/trigger.ts";

/** Runs the trigger on a line where `‸` (or else the first `|`) marks the cursor. */
function at(line: string) {
	const marker = line.includes("‸") ? "‸" : "|";
	const ch = line.indexOf(marker);
	return findTrigger(line.slice(0, ch) + line.slice(ch + 1), ch);
}

test("unclosed bracket", () => {
	assert.deepEqual(at("see [abc|"), { start: 4, end: 8, query: "abc" });
});

test("auto-paired bracket replaces through the ]", () => {
	assert.deepEqual(at("see [abc|]"), { start: 4, end: 9, query: "abc" });
});

test("cursor mid-text queries up to the cursor and replaces the whole bracket", () => {
	assert.deepEqual(at("[ab|c] tail"), { start: 0, end: 5, query: "ab" });
});

test("text with spaces", () => {
	assert.deepEqual(at("[Jira bo|]"), { start: 0, end: 9, query: "Jira bo" });
});

test("cursor at line start and right after [", () => {
	assert.equal(at("|[abc"), null);
	assert.deepEqual(at("[|"), { start: 0, end: 1, query: "" });
});

test("closed bracket and existing links don't trigger", () => {
	assert.equal(at("[abc]|"), null);
	assert.equal(at("[abc|](https://x.com)"), null);
	assert.equal(at("[ab|c](https://x.com)"), null);
	assert.equal(at("[abc](https://x|"), null);
});

test("wikilinks, images, footnotes and escapes don't trigger", () => {
	assert.equal(at("[[abc|"), null);
	assert.equal(at("[[abc|]]"), null);
	assert.equal(at("![abc|"), null);
	assert.equal(at("[^abc|"), null);
	assert.equal(at("\\[abc|"), null);
});

test("task boxes don't trigger, but a link at a list start does", () => {
	assert.equal(at("- [ |]"), null);
	assert.equal(at("- [x|]"), null);
	assert.equal(at("  1. [|"), null);
	assert.equal(at("> - [ |]"), null);
	assert.deepEqual(at("- [ab|"), { start: 2, end: 5, query: "ab" });
	assert.deepEqual(at("- [ ] [ab|"), { start: 6, end: 9, query: "ab" });
});

test("inline code doesn't trigger", () => {
	assert.equal(at("`[abc|"), null);
	assert.deepEqual(at("`x` [abc|"), { start: 4, end: 8, query: "abc" });
});

test("tables, callouts and nested lists trigger", () => {
	assert.deepEqual(at("| [ab‸] | x |"), { start: 2, end: 6, query: "ab" });
	assert.deepEqual(at("> [ab|"), { start: 2, end: 5, query: "ab" });
	assert.deepEqual(at("\t\t- [ab|"), { start: 4, end: 7, query: "ab" });
});

test("after an earlier link on the line", () => {
	assert.deepEqual(at("[a](https://a.com) [ab|"), { start: 19, end: 22, query: "ab" });
	assert.deepEqual(at("[[note]] [ab|"), { start: 9, end: 12, query: "ab" });
});

test("overlong text doesn't trigger", () => {
	assert.equal(at(`[${"x".repeat(200)}|`), null);
});

test("table rows", () => {
	assert.equal(isTableRow("| a | b |"), true);
	assert.equal(isTableRow("> | a |"), true);
	assert.equal(isTableRow("a | b"), false);
});
