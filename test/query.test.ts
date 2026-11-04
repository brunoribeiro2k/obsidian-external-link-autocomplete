import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkIndex } from "../src/index.ts";
import { linkRows, parseQueryOptions, queryLinks } from "../src/query.ts";

function sampleIndex(): LinkIndex {
	const index = new LinkIndex();
	index.setFile("a.md", 1, [
		{ text: "Jira board", url: "https://jira.example.com/board" },
		{ text: "Docs", url: "https://docs.example.com" },
	]);
	index.setFile("b.md", 2, [
		{ text: "jira", url: "https://Jira.example.com/board/" },
		{ text: "Docs", url: "https://other.example.com/docs" },
	]);
	index.setFile("c.md", 3, [{ text: "Jira board", url: "https://jira.example.com/board" }]);
	return index;
}

function query(index: LinkIndex, options?: unknown) {
	return queryLinks(index.pairStats(), (path) => index.mtime(path), options);
}

test("query groups by URL with counts and no paths by default", () => {
	assert.deepEqual(query(sampleIndex()), {
		total: 3,
		groups: [
			{
				label: "https://jira.example.com/board",
				notes: 3,
				variants: [
					{ text: "Jira board", url: "https://jira.example.com/board", notes: 2 },
					{ text: "jira", url: "https://Jira.example.com/board/", notes: 1 },
				],
			},
			{ label: "https://docs.example.com", notes: 1, variants: [{ text: "Docs", url: "https://docs.example.com", notes: 1 }] },
			{
				label: "https://other.example.com/docs",
				notes: 1,
				variants: [{ text: "Docs", url: "https://other.example.com/docs", notes: 1 }],
			},
		],
	});
});

test("query passes grouping, filter and onlyInconsistent to the catalog", () => {
	const index = sampleIndex();
	const byText = query(index, { grouping: "text", onlyInconsistent: true });
	assert.deepEqual(
		byText.groups.map((group) => [group.label, group.variants.map((variant) => variant.url)]),
		[["Docs", ["https://docs.example.com", "https://other.example.com/docs"]]],
	);
	const filtered = query(index, { filter: "OTHER" });
	assert.deepEqual(
		filtered.groups.map((group) => group.label),
		["https://other.example.com/docs"],
	);
});

test("limit cuts the groups but total counts every match", () => {
	const result = query(sampleIndex(), { limit: 1 });
	assert.equal(result.total, 3);
	assert.deepEqual(
		result.groups.map((group) => group.label),
		["https://jira.example.com/board"],
	);
	assert.deepEqual(query(sampleIndex(), { limit: 0 }).groups, []);
});

test("includePaths lists all paths, or caps them", () => {
	const all = query(sampleIndex(), { includePaths: true, limit: 1 });
	assert.deepEqual(all.groups[0].variants[0].paths, ["a.md", "c.md"]);
	const capped = query(sampleIndex(), { includePaths: 1, limit: 1 });
	assert.deepEqual(capped.groups[0].variants[0], {
		text: "Jira board",
		url: "https://jira.example.com/board",
		notes: 2,
		paths: ["a.md"],
	});
	const none = query(sampleIndex(), { includePaths: 0, limit: 1 });
	assert.equal("paths" in none.groups[0].variants[0], false);
});

test("query options default and reject invalid values", () => {
	assert.deepEqual(parseQueryOptions(undefined), {
		catalog: { grouping: "url", sort: "notes", filter: "", onlyInconsistent: false },
		limit: Infinity,
		includePaths: 0,
	});
	const invalid: [unknown, RegExp][] = [
		["url", /must be an object/],
		[[], /must be an object/],
		[{ grouping: "domain" }, /grouping must be one of url, text/],
		[{ sort: "size" }, /sort must be one of/],
		[{ filter: 3 }, /filter must be a string/],
		[{ onlyInconsistent: "yes" }, /onlyInconsistent must be a boolean/],
		[{ limit: -1 }, /limit must be/],
		[{ limit: 1.5 }, /limit must be/],
		[{ includePaths: "3" }, /includePaths must be/],
		[{ fliter: "x" }, /unknown query option "fliter"/],
	];
	for (const [options, message] of invalid) {
		assert.throws(() => parseQueryOptions(options), { name: "TypeError", message });
	}
});

test("rows has one row per link per note, as written there", () => {
	assert.deepEqual(linkRows(sampleIndex().pairStats(), (path) => (path === "b.md" ? 2 : 1)), [
		{ text: "Docs", url: "https://docs.example.com", domain: "docs.example.com", path: "a.md", mtime: 1 },
		{ text: "Jira board", url: "https://jira.example.com/board", domain: "jira.example.com", path: "a.md", mtime: 1 },
		{ text: "jira", url: "https://Jira.example.com/board/", domain: "jira.example.com", path: "b.md", mtime: 2 },
		{ text: "Docs", url: "https://other.example.com/docs", domain: "other.example.com", path: "b.md", mtime: 2 },
		{ text: "Jira board", url: "https://jira.example.com/board", domain: "jira.example.com", path: "c.md", mtime: 1 },
	]);
});
