import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeScalar, insertionStyle, plainSafe, propertyLinkAt, scanFrontmatter } from "../src/frontmatter.ts";

const note = (...lines: string[]): string => ["---", ...lines, "---", "# Body", "[Body](https://body.com)"].join("\n");

const links = (text: string) =>
	scanFrontmatter(text).map(({ text, url, property }) => [property?.name, property?.style, text, url]);

test("reads quoted, plain and list values, with their property", () => {
	const text = note(
		'google-doc: "[📃 GDocs - Plan](https://docs.google.com/document/d/1)"',
		"single: '[Single](https://single.com)'",
		"plain: see [Plain](https://plain.com) here",
		"related:",
		'  - "[First](https://first.com)"',
		"  - '[Second](https://second.com)'",
		'flow: ["[A](https://a.com)", plain, \'[B](https://b.com)\']',
	);
	assert.deepEqual(links(text), [
		["google-doc", "double", "📃 GDocs - Plan", "https://docs.google.com/document/d/1"],
		["single", "single", "Single", "https://single.com"],
		["plain", "plain", "Plain", "https://plain.com"],
		["related", "double", "First", "https://first.com"],
		["related", "single", "Second", "https://second.com"],
		["flow", "double", "A", "https://a.com"],
		["flow", "single", "B", "https://b.com"],
	]);
});

test("never reads the body, and needs frontmatter at the very top", () => {
	assert.deepEqual(links(note("title: Plain")), []);
	assert.deepEqual(links('\n---\nsource: "[X](https://x.com)"\n---'), []);
	assert.deepEqual(links('---\nsource: "[X](https://x.com)"'), []);
});

test("decodes escapes, and maps every column back to the raw line", () => {
	const line = 'quote: "[Say \\"hi\\" \\\\ \\u00e9](https://x.com/a\\"b)"';
	const [link] = scanFrontmatter(note(line));
	assert.equal(link.text, 'Say "hi" \\ é');
	assert.equal(link.url, 'https://x.com/a"b');
	assert.equal(link.line, 1);
	assert.equal(line.slice(link.start, link.end), '[Say \\"hi\\" \\\\ \\u00e9](https://x.com/a\\"b)');
	assert.equal(line.slice(link.start + 1, link.textEnd), 'Say \\"hi\\" \\\\ \\u00e9');
	assert.equal(line.slice(link.urlStart, link.urlEnd), 'https://x.com/a\\"b');
	assert.deepEqual(link.property, { name: "quote", style: "double", start: 7, end: line.length });
});

test("decodes doubled quotes in single-quoted values", () => {
	const line = "s: '[It''s here](https://x.com)'";
	const [link] = scanFrontmatter(note(line));
	assert.equal(link.text, "It's here");
	assert.equal(line.slice(link.start + 1, link.textEnd), "It''s here");
});

test("reads quoted keys, and Markdown escapes written for YAML", () => {
	assert.deepEqual(links(note('"my key": "[A \\\\] b](https://a.com)"', "'it''s': '[B](https://b.com)'")), [
		["my key", "double", "A \\] b", "https://a.com"],
		["it's", "single", "B", "https://b.com"],
	]);
});

test("skips comments, block scalars, nested maps and values that don't close on their line", () => {
	const text = note(
		'# note: "[Comment](https://comment.com)"',
		'key: "[Kept](https://kept.com)" # "[Trailing](https://trailing.com)"',
		"block: |",
		'  "[Block](https://block.com)"',
		'  - "[Block item](https://block-item.com)"',
		"nested:",
		'  sub: "[Nested](https://nested.com)"',
		'open: "[Open](https://open.com)',
		'  continued"',
		"map: a: [M](https://map.com)",
		'after: "[After](https://after.com)"',
	);
	assert.deepEqual(links(text), [
		["key", "double", "Kept", "https://kept.com"],
		["after", "double", "After", "https://after.com"],
	]);
});

test("a plain value stops at a comment", () => {
	assert.deepEqual(links(note("p: [x] [A](https://a.com) # [B](https://b.com)")), []);
	assert.deepEqual(links(note("p: x [A](https://a.com) # [B](https://b.com)")), [["p", "plain", "A", "https://a.com"]]);
});

test("finds the property link under a column", () => {
	const lines = ["---", 'a: "[A](https://a.com)"', "---"];
	assert.equal(propertyLinkAt(lines, 1, 5)?.text, "A");
	assert.equal(propertyLinkAt(lines, 1, 1), null);
	assert.equal(propertyLinkAt(lines, 0, 0), null);
});

test("knows how a link typed in a value must be written", () => {
	const at = (line: string, open = line.lastIndexOf("[")) => insertionStyle(["---", line, "---"], 1, open);
	assert.equal(at('key: "[ab]"'), "double");
	assert.equal(at("key: '[ab'"), "single");
	assert.equal(at('key: "[ab'), "double");
	assert.equal(at("key: see [ab"), "plain");
	assert.equal(at("key: [ab]"), "wrap");
	assert.equal(at("  - [ab"), null);
	assert.equal(insertionStyle(["---", "key:", "  - [ab", "---"], 2, 4), "wrap");
	assert.equal(at('key: ["[A](https://a.com)", [ab'), "wrap");
	assert.equal(at('key: ["[a'), "double");
	assert.equal(at("[ab: x"), null);
	assert.equal(at("# [ab"), null);
	assert.equal(insertionStyle(["---", "key: [ab", "---"], 2, 0), null);
});

test("encodes for each quoting style", () => {
	assert.equal(encodeScalar('a "b" \\ c', "double"), 'a \\"b\\" \\\\ c');
	assert.equal(encodeScalar("it's", "single"), "it''s");
	assert.equal(encodeScalar("it's", "plain"), "it's");
	assert.equal(plainSafe("Docs: intro"), false);
	assert.equal(plainSafe("a #b"), false);
	assert.equal(plainSafe("a:b#c"), true);
});
