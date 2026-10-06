import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkIndex } from "../src/index.ts";
import { rank, Tier, type RankOptions } from "../src/ranking.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

/** Builds an index from `[path, ageInDays, [text, url][]]` notes. */
function indexOf(notes: [string, number, [string, string][]][]): LinkIndex {
	const index = new LinkIndex();
	for (const [path, age, links] of notes) {
		index.setFile(
			path,
			NOW - age * DAY,
			links.map(([text, url]) => ({ text, url })),
		);
	}
	return index;
}

function query(index: LinkIndex, q: string, options: Partial<RankOptions> = {}) {
	return rank(q, index.entries(), { mode: "balanced", multiUrl: "all", limit: 20, now: NOW, ...options });
}

test("tiers: exact, prefix, word prefix, fuzzy", () => {
	const index = indexOf([
		[
			"a.md",
			0,
			[
				["Board", "https://exact.com"],
				["Board games", "https://prefix.com"],
				["Jira board", "https://word.com"],
				["Big old ardent", "https://fuzzy.com"],
			],
		],
	]);
	const rows = query(index, "board");
	assert.deepEqual(
		rows.map((row) => [row.display, row.tier]),
		[
			["Board", Tier.Exact],
			["Board games", Tier.Prefix],
			["Jira board", Tier.WordPrefix],
			["Big old ardent", Tier.Fuzzy],
		],
	);
	assert.deepEqual(rows[2].matches, [[5, 10]]);
});

test("a better tier beats a more used link", () => {
	const popular: [string, number, [string, string][]][] = Array.from({ length: 10 }, (_, i) => [
		`p${i}.md`,
		0,
		[["Jira board", "https://popular.com"]],
	]);
	const index = indexOf([...popular, ["x.md", 900, [["Board games", "https://rare.com"]]]]);
	assert.deepEqual(
		query(index, "boa").map((row) => row.display),
		["Board games", "Jira board"],
	);
});

test("counts distinct notes, not occurrences", () => {
	const index = indexOf([
		[
			"spam.md",
			0,
			[
				["Docs", "https://a.com"],
				["Docs", "https://a.com"],
				["Docs", "https://a.com"],
			],
		],
		["one.md", 0, [["Docs", "https://b.com"]]],
		["two.md", 0, [["Docs", "https://b.com"]]],
	]);
	const rows = query(index, "docs", { mode: "frequency" });
	assert.deepEqual(
		rows.map((row) => [row.url, row.notes]),
		[
			["https://b.com", 2],
			["https://a.com", 1],
		],
	);
});

test("modes order URLs by frequency or recency", () => {
	const index = indexOf([
		["old1.md", 400, [["Docs", "https://old.com"]]],
		["old2.md", 400, [["Docs", "https://old.com"]]],
		["old3.md", 400, [["Docs", "https://old.com"]]],
		["new.md", 1, [["Docs", "https://new.com"]]],
	]);
	assert.equal(query(index, "docs", { mode: "frequency" })[0].url, "https://old.com");
	assert.equal(query(index, "docs", { mode: "recency" })[0].url, "https://new.com");
	assert.equal(query(index, "docs", { mode: "balanced" })[0].url, "https://new.com");
});

test("multi-URL modes keep one row", () => {
	const index = indexOf([
		["a.md", 300, [["Docs", "https://used.com"]]],
		["b.md", 300, [["Docs", "https://used.com"]]],
		["c.md", 1, [["Docs", "https://recent.com"]]],
	]);
	assert.deepEqual(
		query(index, "docs", { multiUrl: "recent" }).map((row) => row.url),
		["https://recent.com"],
	);
	assert.deepEqual(
		query(index, "docs", { multiUrl: "used" }).map((row) => row.url),
		["https://used.com"],
	);
	assert.equal(query(index, "docs").length, 2);
});

test("ties go to the shorter text, then alphabetical", () => {
	const index = indexOf([
		[
			"a.md",
			0,
			[
				["abcd", "https://4.com"],
				["abc b", "https://5b.com"],
				["abc a", "https://5a.com"],
				["abc", "https://3.com"],
			],
		],
	]);
	assert.deepEqual(
		query(index, "ab").map((row) => row.display),
		["abc", "abcd", "abc a", "abc b"],
	);
});

test("folds case and diacritics, and highlights the original text", () => {
	const index = indexOf([["a.md", 0, [["Café **Crème**", "https://cafe.com"]]]]);
	const [row] = query(index, "CAFE c");
	assert.equal(row.text, "Café **Crème**");
	assert.equal(row.display, "Café Crème");
	assert.deepEqual(row.matches, [[0, 6]]);
});

test("the most frequent spelling is inserted", () => {
	const index = indexOf([
		["a.md", 0, [["GitHub", "https://github.com"]]],
		["b.md", 0, [["GitHub", "https://github.com/"]]],
		["c.md", 0, [["github", "https://github.com"]]],
	]);
	const rows = query(index, "git");
	assert.equal(rows.length, 1);
	assert.equal(rows[0].text, "GitHub");
	assert.equal(rows[0].url, "https://github.com");
	assert.equal(rows[0].notes, 3);
});

test("limit caps rows and an empty query returns nothing", () => {
	const index = indexOf([
		[
			"a.md",
			0,
			Array.from({ length: 30 }, (_, i): [string, string] => [`item ${i}`, `https://${i}.com`]),
		],
	]);
	assert.equal(query(index, "item", { limit: 8 }).length, 8);
	assert.deepEqual(query(index, "  "), []);
});
