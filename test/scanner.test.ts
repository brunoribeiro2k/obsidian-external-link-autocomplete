import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackSkipRanges, scan } from "../src/scanner.ts";

const pairs = (text: string, skip?: [number, number][]) =>
	scan(text, skip).map(({ text, url }) => [text, url]);

test("finds a plain link", () => {
	assert.deepEqual(pairs("see [Docs](https://docs.obsidian.md/Home) now"), [
		["Docs", "https://docs.obsidian.md/Home"],
	]);
});

test("finds several links on one line", () => {
	assert.deepEqual(pairs("[a](https://a.com) and [b](http://b.com)"), [
		["a", "https://a.com"],
		["b", "http://b.com"],
	]);
});

test("keeps balanced parentheses in the URL", () => {
	assert.deepEqual(pairs("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))"), [
		["Foo", "https://en.wikipedia.org/wiki/Foo_(bar)"],
	]);
});

test("reads angle-bracket destinations with spaces", () => {
	assert.deepEqual(pairs("[Spaced](<https://example.com/a path>)"), [["Spaced", "https://example.com/a path"]]);
});

test("accepts link titles", () => {
	assert.deepEqual(pairs('[T](https://example.com/t "A title") [U](https://u.com \'x\') [V](https://v.com (y))'), [
		["T", "https://example.com/t"],
		["U", "https://u.com"],
		["V", "https://v.com"],
	]);
});

test("handles nested brackets and escapes in the text", () => {
	assert.deepEqual(pairs("[a [b] c](https://x.com) [d \\] e](https://y.com)"), [
		["a [b] c", "https://x.com"],
		["d \\] e", "https://y.com"],
	]);
});

test("finds a link inside a bracket that isn't one", () => {
	assert.deepEqual(pairs("[note [inner](https://x.com) more]"), [["inner", "https://x.com"]]);
});

test("keeps a text that is itself a URL", () => {
	assert.deepEqual(pairs("[https://x.com/self](https://x.com/self)"), [["https://x.com/self", "https://x.com/self"]]);
});

test("skips images, wikilinks, footnotes and internal links", () => {
	const text = [
		"![Image](https://example.com/image.png)",
		"[[Wikilink]] [[Note|alias]]",
		"[^1](https://example.com/footnote)",
		"[Internal](Some%20note.md) [Mail](mailto:a@b.com)",
		"[![badge](https://img.shields.io/x.svg)](https://github.com/x)",
	].join("\n");
	assert.deepEqual(pairs(text), []);
});

test("skips inline code, autolinks and reference definitions", () => {
	const text = [
		"`[In code](https://example.com/code)` ``[two `ticks`](https://x.com)``",
		"<https://example.com/autolink>",
		"[ref]: https://example.com/ref",
		"[ref][id] and [Escaped\\](https://x.com)",
	].join("\n");
	assert.deepEqual(pairs(text), []);
});

test("an unclosed backtick is literal", () => {
	assert.deepEqual(pairs("a ` b [x](https://x.com)"), [["x", "https://x.com"]]);
});

test("skips empty and overlong texts", () => {
	const long = "x".repeat(121);
	assert.deepEqual(pairs(`[](https://a.com) [  ](https://b.com) [${long}](https://c.com)`), []);
});

test("rejects malformed destinations", () => {
	assert.deepEqual(pairs("[a](https://x.com [b](https://y.com unclosed"), []);
});

test("splits CRLF lines and reports line numbers", () => {
	assert.deepEqual(
		scan("one\r\n[a](https://a.com)\r\nthree [b](https://b.com)").map((o) => o.line),
		[1, 2],
	);
});

test("indexes links in tables, callouts and lists", () => {
	const text = ["| [T](https://t.com) | x |", "> [!note]", "> [C](https://c.com)", "- [L](https://l.com)"].join(
		"\n",
	);
	assert.deepEqual(pairs(text), [
		["T", "https://t.com"],
		["C", "https://c.com"],
		["L", "https://l.com"],
	]);
});

test("honors skip ranges", () => {
	const text = "[a](https://a.com)\n[b](https://b.com)\n[c](https://c.com)";
	assert.deepEqual(pairs(text, [[1, 1]]), [
		["a", "https://a.com"],
		["c", "https://c.com"],
	]);
});

test("fallback skip ranges cover frontmatter and fences", () => {
	const text = [
		"---",
		"url: '[x](https://x.com)'",
		"---",
		"[a](https://a.com)",
		"```md",
		"[b](https://b.com)",
		"```",
		"~~~~",
		"```",
		"[c](https://c.com)",
		"~~~~",
		"[d](https://d.com)",
	].join("\n");
	assert.deepEqual(pairs(text, fallbackSkipRanges(text)), [
		["a", "https://a.com"],
		["d", "https://d.com"],
	]);
});

test("an unclosed fence runs to the end", () => {
	const text = "```\n[a](https://a.com)";
	assert.deepEqual(pairs(text, fallbackSkipRanges(text)), []);
});

test("reports the columns of each link", () => {
	const line = "see [a](https://a.com) and [b](<https://b.com> \"t\")";
	assert.deepEqual(
		scan(line).map(({ start, end }) => line.slice(start, end)),
		["[a](https://a.com)", '[b](<https://b.com> "t")'],
	);
});
