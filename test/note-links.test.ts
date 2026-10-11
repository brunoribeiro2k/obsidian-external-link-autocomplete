import { test } from "node:test";
import assert from "node:assert/strict";
import { noteLinks } from "../src/note-links.ts";
import { scan } from "../src/scanner.ts";

test("groups a note's links by URL, in order of first appearance", () => {
	const links = noteLinks(
		scan(
			[
				"See [Docs](https://docs.example.com/) and [Jira](https://jira.example.com).",
				"Again: [docs](https://DOCS.example.com) and [the **docs**](https://docs.example.com).",
			].join("\n"),
		),
	);
	assert.deepEqual(
		links.map((link) => ({ url: link.url, texts: link.texts, count: link.count, line: link.first.line })),
		[
			{ url: "https://docs.example.com/", texts: ["Docs", "the **docs**"], count: 3, line: 0 },
			{ url: "https://jira.example.com", texts: ["Jira"], count: 1, line: 0 },
		],
	);
});

test("points at the first link to each URL", () => {
	const [link] = noteLinks(scan("x\n  [a](https://a.example.com) [b](https://a.example.com)"));
	assert.equal(link.first.line, 1);
	assert.equal(link.first.start, 2);
	assert.equal(link.first.text, "a");
});

test("a note without links has none", () => {
	assert.deepEqual(noteLinks(scan("no links, just [[wiki]] and [local](note.md)")), []);
});
