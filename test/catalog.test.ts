import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, excerpt, isVariantOf, type CatalogOptions } from "../src/catalog.ts";
import { LinkIndex } from "../src/index.ts";

function sampleIndex(): LinkIndex {
	const index = new LinkIndex();
	index.setFile("a.md", 1, [
		{ text: "Jira board", url: "https://jira.example.com/board" },
		{ text: "Docs", url: "https://docs.example.com" },
	]);
	index.setFile("b.md", 2, [
		{ text: "jira", url: "https://jira.example.com/board/" },
		{ text: "Docs", url: "https://other.example.com/docs" },
	]);
	index.setFile("c.md", 3, [{ text: "Jira board", url: "https://jira.example.com/board" }]);
	return index;
}

function catalog(index: LinkIndex, options: Partial<CatalogOptions> = {}) {
	return buildCatalog(index.pairStats(), (path) => index.mtime(path), {
		grouping: "url",
		sort: "notes",
		filter: "",
		onlyInconsistent: false,
		...options,
	});
}

test("groups by URL, with the texts used for each", () => {
	const groups = catalog(sampleIndex());
	assert.deepEqual(
		groups.map((group) => [group.label, group.notes, group.variants.map((variant) => [variant.text, variant.paths])]),
		[
			["https://jira.example.com/board", 3, [["Jira board", ["a.md", "c.md"]], ["jira", ["b.md"]]]],
			["https://docs.example.com", 1, [["Docs", ["a.md"]]]],
			["https://other.example.com/docs", 1, [["Docs", ["b.md"]]]],
		],
	);
});

test("groups by text, with the URLs each points at", () => {
	const groups = catalog(sampleIndex(), { grouping: "text" });
	assert.deepEqual(
		groups.map((group) => [group.label, group.notes, group.variants.map((variant) => variant.url)]),
		[
			["Docs", 2, ["https://docs.example.com", "https://other.example.com/docs"]],
			["Jira board", 2, ["https://jira.example.com/board"]],
			["jira", 1, ["https://jira.example.com/board/"]],
		],
	);
});

test("only inconsistent keeps groups with several variants", () => {
	assert.deepEqual(
		catalog(sampleIndex(), { onlyInconsistent: true }).map((group) => group.label),
		["https://jira.example.com/board"],
	);
	assert.deepEqual(
		catalog(sampleIndex(), { grouping: "text", onlyInconsistent: true }).map((group) => group.label),
		["Docs"],
	);
});

test("the filter matches texts and URLs, folded", () => {
	assert.deepEqual(
		catalog(sampleIndex(), { filter: "JIRA" }).map((group) => group.label),
		["https://jira.example.com/board"],
	);
	assert.deepEqual(
		catalog(sampleIndex(), { grouping: "text", filter: "other.example" }).map((group) => group.label),
		["Docs"],
	);
});

test("sorts by name and by recency", () => {
	assert.deepEqual(
		catalog(sampleIndex(), { grouping: "text", sort: "name" }).map((group) => group.label),
		["Docs", "jira", "Jira board"],
	);
	assert.deepEqual(
		catalog(sampleIndex(), { grouping: "text", sort: "recent" }).map((group) => [group.label, group.lastUsed]),
		[
			["Jira board", 3],
			["Docs", 2],
			["jira", 2],
		],
	);
});

test("pair stats follow index updates and report them", () => {
	let changes = 0;
	const index = new LinkIndex(() => changes++);
	index.setFile("a.md", 1, [{ text: "A", url: "https://a.com" }]);
	index.renameFile("a.md", "b.md");
	assert.deepEqual(
		[...index.pairStats()].map((stat) => [stat.key, stat.urlKey, [...stat.paths]]),
		[["a", "https://a.com", ["b.md"]]],
	);
	index.removeFile("b.md");
	assert.equal([...index.pairStats()].length, 0);
	assert.ok(changes >= 3);
});

test("recognizes instances of a variant", () => {
	const variant = { key: "jira board", urlKey: "https://jira.example.com/board" };
	const at = { line: 0, start: 0, end: 0 };
	assert.ok(isVariantOf({ text: "**Jira** Board", url: "HTTPS://jira.example.com/board/", ...at }, variant));
	assert.ok(!isVariantOf({ text: "Jira", url: "https://jira.example.com/board", ...at }, variant));
});

test("cuts long lines around the link", () => {
	const line = `${"x".repeat(60)} [a](https://a.com) ${"y".repeat(60)}`;
	const start = line.indexOf("[");
	const end = line.indexOf(")") + 1;
	const cut = excerpt(line, start, end, 10);
	assert.equal(cut.match, "[a](https://a.com)");
	assert.equal(cut.before, "…xxxxxxxxx ");
	assert.equal(cut.after, " yyyyyyyyy…");
	assert.deepEqual(excerpt("  see [a](u) now  ", 6, 12), { before: "see ", match: "[a](u)", after: " now" });
});
