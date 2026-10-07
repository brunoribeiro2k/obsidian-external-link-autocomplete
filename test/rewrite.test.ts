import { test } from "node:test";
import assert from "node:assert/strict";
import { pairFilter } from "../src/index.ts";
import { appliedLinks, applyChanges, isValidLink, linkAt, planRevert, planRewrite, type RewriteSpec } from "../src/rewrite.ts";
import { fallbackSkipRanges } from "../src/scanner.ts";

const spec = (overrides: Partial<RewriteSpec> = {}): RewriteSpec => ({
	key: "a",
	urlKey: "https://aaa.com",
	allTexts: false,
	text: "a2",
	url: "https://aaa.com",
	keep: () => true,
	...overrides,
});

const rewrite = (content: string, options: Partial<RewriteSpec> = {}): string =>
	applyChanges(content, planRewrite(content, fallbackSkipRanges(content), spec(options)));

test("renames only the matching pair by default", () => {
	assert.equal(
		rewrite("[a](https://aaa.com) [b](https://aaa.com) [a](https://other.com)"),
		"[a2](https://aaa.com) [b](https://aaa.com) [a](https://other.com)",
	);
});

test("matches text and URL variants, and writes both as typed", () => {
	assert.equal(rewrite("[**A**](HTTPS://aaa.com/) and [ a ](https://aaa.com)"), "[a2](https://aaa.com) and [a2](https://aaa.com)");
});

test("with all texts, every link to the URL gets the new text", () => {
	assert.equal(
		rewrite("[a](https://aaa.com) [b](https://aaa.com) [c](https://ccc.com)", { allTexts: true }),
		"[a2](https://aaa.com) [a2](https://aaa.com) [c](https://ccc.com)",
	);
});

test("changes the URL, keeping titles and angle brackets formatting right", () => {
	assert.equal(
		rewrite('[a](https://aaa.com "Title") [a](<https://aaa.com>)', { text: "a", url: "https://new.com/a b" }),
		'[a](<https://new.com/a b> "Title") [a](<https://new.com/a b>)',
	);
});

test("leaves code, frontmatter and ignored texts alone", () => {
	const content = [
		"---",
		"src: [a](https://aaa.com)",
		"---",
		"```",
		"[a](https://aaa.com)",
		"```",
		"`[a](https://aaa.com)` [here](https://aaa.com) [a](https://aaa.com)",
	].join("\n");
	const keep = pairFilter({ ignoredTexts: ["here"], ignoredDomains: [] });
	assert.equal(
		rewrite(content, { allTexts: true, keep }),
		content.replace("[here](https://aaa.com) [a](https://aaa.com)", "[here](https://aaa.com) [a2](https://aaa.com)"),
	);
});

test("escapes pipes in table rows", () => {
	assert.equal(rewrite("| [a](https://aaa.com) |", { text: "a|b" }), "| [a\\|b](https://aaa.com) |");
});

test("keeps CRLF line endings and handles several links per line", () => {
	assert.equal(
		rewrite("x\r\n[a](https://aaa.com) [a](https://aaa.com)\r\ny", { text: "longer text" }),
		"x\r\n[longer text](https://aaa.com) [longer text](https://aaa.com)\r\ny",
	);
});

test("plans nothing when links already match", () => {
	assert.deepEqual(planRewrite("[a2](https://aaa.com)", [], spec({ key: "a2" })), []);
});

test("finds the link under the cursor", () => {
	const line = "see [a](https://aaa.com) and [b](https://b.com)";
	assert.equal(linkAt(line, 4)?.text, "a");
	assert.equal(linkAt(line, line.indexOf("and") + 4)?.text, "b");
	assert.equal(linkAt(line, 1), null);
});

test("validates the edited link", () => {
	assert.ok(isValidLink("Jira board", "https://jira.example.com"));
	assert.ok(isValidLink("Foo (bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"));
	assert.ok(!isValidLink("", "https://a.com"));
	assert.ok(!isValidLink("a]b", "https://a.com"));
	assert.ok(!isValidLink("a", "ftp://a.com"));
});

test("reverts a rewrite, including several links per line", () => {
	const content = 'x\r\n[a](https://aaa.com "T") [b](https://aaa.com) [a](https://aaa.com)\r\ny';
	const changes = planRewrite(content, [], spec({ allTexts: true, text: "longer", url: "https://new.com" }));
	const rewritten = applyChanges(content, changes);
	assert.equal(rewritten, 'x\r\n[longer](https://new.com "T") [longer](https://new.com) [longer](https://new.com)\r\ny');
	const applied = appliedLinks(content, changes);
	const { changes: revert, skipped } = planRevert(rewritten, applied);
	assert.equal(skipped, 0);
	assert.equal(applyChanges(rewritten, revert), content);
});

test("leaves links edited since the rewrite alone", () => {
	const content = "[a](https://aaa.com) [a](https://aaa.com)";
	const changes = planRewrite(content, [], spec());
	const rewritten = applyChanges(content, changes);
	const edited = rewritten.replace("[a2](https://aaa.com) ", "[mine](https://aaa.com) ");
	const { changes: revert, skipped } = planRevert(edited, appliedLinks(content, changes));
	assert.equal(skipped, 1);
	assert.equal(applyChanges(edited, revert), "[mine](https://aaa.com) [a](https://aaa.com)");
	assert.equal(planRevert("moved\n" + rewritten, appliedLinks(content, changes)).skipped, 2);
});
