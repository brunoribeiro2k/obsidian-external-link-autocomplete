import { test } from "node:test";
import assert from "node:assert/strict";
import {
	describeUrl,
	domainMatcher,
	escapePipes,
	fold,
	foldWithMap,
	formatDestination,
	hostOf,
	mapMatches,
	normUrl,
	stripMarkdown,
} from "../src/text.ts";

test("fold lowercases, strips diacritics and collapses whitespace", () => {
	assert.equal(fold("  Café   Crème "), "cafe creme");
	assert.equal(fold("ＡＢＣ"), "abc");
	assert.equal(fold("Straße"), "straße");
});

test("foldWithMap maps folded characters back to the original", () => {
	const text = "É  x";
	const { folded, map } = foldWithMap(text);
	assert.equal(folded, "e x");
	assert.deepEqual(map, [0, 1, 3]);
	assert.deepEqual(mapMatches([[0, 3]], map, text), [[0, 4]]);
});

test("stripMarkdown removes emphasis and resolves escapes", () => {
	assert.equal(stripMarkdown("**Bold** _it_ `code` ~~gone~~ ==hl=="), "Bold it code gone hl");
	assert.equal(stripMarkdown("a \\| b \\*"), "a | b *");
	assert.equal(stripMarkdown("1 + 1 = 2 ~ 3"), "1 + 1 = 2 ~ 3");
});

test("normUrl lowercases scheme and host and drops a trailing slash", () => {
	assert.equal(normUrl("HTTPS://Example.COM/Path/"), "https://example.com/Path");
	assert.equal(normUrl("https://example.com/"), "https://example.com");
	assert.equal(normUrl("https://x.com/a/?q=1#F"), "https://x.com/a?q=1#F");
});

test("hostOf strips credentials and port", () => {
	assert.equal(hostOf("https://user:pw@Sub.Example.com:8080/x"), "sub.example.com");
	assert.equal(hostOf("not a url"), "");
});

test("describeUrl drops www and middle-ellipsizes long paths", () => {
	assert.deepEqual(describeUrl("https://www.example.com/a/b/"), { host: "example.com", path: "a/b" });
	const { path } = describeUrl(`https://x.com/${"a".repeat(30)}${"b".repeat(30)}`, 11);
	assert.equal(path, "aaaaa…bbbbb");
});

test("domainMatcher supports globs", () => {
	const ignored = domainMatcher(["*.internal.example.com", "Example.org", " "]);
	assert.equal(ignored("a.internal.example.com"), true);
	assert.equal(ignored("internal.example.com"), false);
	assert.equal(ignored("example.org"), true);
	assert.equal(ignored("example.org.evil.com"), false);
	assert.equal(domainMatcher([])("x.com"), false);
});

test("formatDestination wraps URLs that need it", () => {
	assert.equal(formatDestination("https://x.com/Foo_(bar)"), "https://x.com/Foo_(bar)");
	assert.equal(formatDestination("https://x.com/a b"), "<https://x.com/a b>");
	assert.equal(formatDestination("https://x.com/a)"), "<https://x.com/a)>");
	assert.equal(formatDestination("https://x.com/<a>"), "<https://x.com/%3Ca%3E>");
});

test("escapePipes leaves escaped pipes alone", () => {
	assert.equal(escapePipes("a|b\\|c"), "a\\|b\\|c");
});
