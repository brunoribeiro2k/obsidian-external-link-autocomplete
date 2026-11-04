import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkIndex } from "../src/index.ts";
import { linkRows, parseDomain, parseFolder, parseQueryOptions, queryLinks } from "../src/query.ts";

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
		grouping: "url",
		sort: "notes",
		filter: "",
		onlyInconsistent: false,
		minNotes: 0,
		limit: Infinity,
		variantLimit: Infinity,
		includePaths: 0,
		keep: null,
	});
	const invalid: [unknown, RegExp][] = [
		["url", /must be an object/],
		[[], /must be an object/],
		[{ grouping: "host" }, /grouping must be one of url, text, domain/],
		[{ sort: "size" }, /sort must be one of/],
		[{ filter: 3 }, /filter must be a string/],
		[{ onlyInconsistent: "yes" }, /onlyInconsistent must be a boolean/],
		[{ limit: -1 }, /limit must be/],
		[{ limit: 1.5 }, /limit must be/],
		[{ includePaths: "3" }, /includePaths must be/],
		[{ fliter: "x" }, /unknown query option "fliter"/],
		[{ folder: "" }, /folder must not be empty/],
		[{ folder: "/" }, /folder must not be empty/],
		[{ folder: [] }, /folder must not be an empty list/],
		[{ folder: ["a", 3] }, /folder must be a string or a list of strings/],
		[{ grouping: "domain", onlyInconsistent: true }, /onlyInconsistent doesn't apply to "domain" grouping/],
		[{ minNotes: -2 }, /minNotes must be/],
		[{ variantLimit: "3" }, /variantLimit must be/],
		[{ domain: "" }, /domain must not be empty/],
		[{ domain: [] }, /domain must not be an empty list/],
		[{ domain: "https://github.com" }, /must be a host name/],
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

function dailyIndex(): LinkIndex {
	const index = new LinkIndex();
	index.setFile("daily/2026-10/01.md", 1, [{ text: "Board", url: "https://jira.example.com/board" }]);
	index.setFile("daily/2026-10/02.md", 2, [{ text: "Board", url: "https://jira.example.com/board" }]);
	index.setFile("daily/2026-11/01.md", 3, [{ text: "Jira", url: "https://jira.example.com/board" }]);
	index.setFile("daily/2026-09/01.md", 4, [{ text: "Old board", url: "https://jira.example.com/board" }]);
	index.setFile("daily/2026-100.md", 5, [{ text: "Not a folder match", url: "https://jira.example.com/board" }]);
	index.setFile("projects/x.md", 6, [{ text: "Board", url: "https://jira.example.com/board" }]);
	return index;
}

test("folder scopes the notes before grouping", () => {
	const index = dailyIndex();
	const october = query(index, { folder: "daily/2026-10", includePaths: true });
	assert.deepEqual(october, {
		total: 1,
		groups: [
			{
				label: "https://jira.example.com/board",
				notes: 2,
				variants: [
					{ text: "Board", url: "https://jira.example.com/board", notes: 2, paths: ["daily/2026-10/01.md", "daily/2026-10/02.md"] },
				],
			},
		],
	});
	// Inconsistent across the vault, but not within October alone.
	assert.equal(query(index, { onlyInconsistent: true }).total, 1);
	assert.equal(query(index, { folder: "daily/2026-10", onlyInconsistent: true }).total, 0);
	const autumn = query(index, { folder: ["/daily/2026-10/", "daily//2026-11"], onlyInconsistent: true });
	assert.deepEqual(
		autumn.groups[0].variants.map((variant) => [variant.text, variant.notes]),
		[
			["Board", 2],
			["Jira", 1],
		],
	);
	assert.equal(autumn.groups[0].notes, 3);
});

test("folder matches whole path segments", () => {
	const inFolder = parseFolder("daily/2026-10");
	assert.ok(inFolder);
	assert.equal(inFolder("daily/2026-10/01.md"), true);
	assert.equal(inFolder("daily/2026-100.md"), false);
	assert.equal(inFolder("daily/2026-1"), false);
	assert.equal(parseFolder(undefined), null);
});

test("rows takes a folder and rejects unknown options", () => {
	const index = dailyIndex();
	const rows = linkRows(index.pairStats(), (path) => index.mtime(path), { folder: ["daily/2026-11", "projects"] });
	assert.deepEqual(
		rows.map((row) => [row.path, row.text]),
		[
			["daily/2026-11/01.md", "Jira"],
			["projects/x.md", "Board"],
		],
	);
	assert.throws(() => linkRows(index.pairStats(), () => 0, { limit: 3 }), { name: "TypeError", message: /unknown rows option "limit"/ });
});

function domainIndex(): LinkIndex {
	const index = new LinkIndex();
	index.setFile("a.md", 1, [
		{ text: "Repo", url: "https://github.com/acme/repo" },
		{ text: "Gist", url: "https://gist.github.com/acme/1" },
		{ text: "Docs", url: "https://docs.example.com" },
	]);
	index.setFile("b.md", 2, [
		{ text: "repo", url: "https://GitHub.com/acme/repo/" },
		{ text: "Issues", url: "https://github.com/acme/repo/issues" },
	]);
	index.setFile("c.md", 3, [{ text: "Repo", url: "https://github.com/acme/repo" }]);
	return index;
}

test("domain grouping has one group per host, its URLs as variants", () => {
	assert.deepEqual(query(domainIndex(), { grouping: "domain" }), {
		total: 3,
		groups: [
			{
				label: "github.com",
				notes: 3,
				variants: [
					{ text: "Repo", url: "https://github.com/acme/repo", notes: 3 },
					{ text: "Issues", url: "https://github.com/acme/repo/issues", notes: 1 },
				],
			},
			{ label: "docs.example.com", notes: 1, variants: [{ text: "Docs", url: "https://docs.example.com", notes: 1 }] },
			{ label: "gist.github.com", notes: 1, variants: [{ text: "Gist", url: "https://gist.github.com/acme/1", notes: 1 }] },
		],
	});
	assert.deepEqual(
		query(domainIndex(), { grouping: "domain", filter: "issues" }).groups.map((group) => [group.label, group.variants.length]),
		[["github.com", 2]],
	);
	assert.deepEqual(
		query(domainIndex(), { grouping: "domain", sort: "name" }).groups.map((group) => group.label),
		["docs.example.com", "gist.github.com", "github.com"],
	);
});

test("domain keeps a host and its subdomains, with globs", () => {
	const inDomain = parseDomain(["GitHub.com.", "*.atlassian.net"]);
	assert.ok(inDomain);
	assert.equal(inDomain("github.com"), true);
	assert.equal(inDomain("gist.github.com"), true);
	assert.equal(inDomain("notgithub.com"), false);
	assert.equal(inDomain("acme.atlassian.net"), true);
	assert.equal(parseDomain(undefined), null);

	const result = query(domainIndex(), { domain: "github.com", grouping: "text" });
	assert.deepEqual(
		result.groups.map((group) => group.label),
		["Repo", "Gist", "Issues"],
	);
	const rows = linkRows(domainIndex().pairStats(), () => 0, { domain: "gist.github.com" });
	assert.deepEqual(
		rows.map((row) => row.url),
		["https://gist.github.com/acme/1"],
	);
});

test("minNotes keeps groups used in enough notes, and total follows it", () => {
	const result = query(domainIndex(), { minNotes: 2 });
	assert.equal(result.total, 1);
	assert.deepEqual(
		result.groups.map((group) => [group.label, group.notes]),
		[["https://github.com/acme/repo", 3]],
	);
	assert.equal(query(domainIndex(), { minNotes: 4 }).total, 0);
});

test("variantLimit caps variants and reports the full count", () => {
	const [github] = query(domainIndex(), { grouping: "domain", variantLimit: 1, limit: 1 }).groups;
	assert.deepEqual(github, {
		label: "github.com",
		notes: 3,
		variantCount: 2,
		variants: [{ text: "Repo", url: "https://github.com/acme/repo", notes: 3 }],
	});
	const [uncut] = query(domainIndex(), { grouping: "domain", variantLimit: 5, limit: 1 }).groups;
	assert.equal("variantCount" in uncut, false);
});
