import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkIndex, pairFilter, type LinkPair } from "../src/index.ts";

/** Deterministic PRNG so failures reproduce. */
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}

test("incremental updates match a full rebuild", () => {
	const next = random(42);
	const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
	const texts = ["Docs", "docs", "Jira board", "Café", "cafe", "**Bold**", "GitHub"];
	const urls = ["https://a.com", "https://a.com/", "HTTPS://A.com", "https://b.com/x", "https://c.com?q=1"];
	const randomPairs = (): LinkPair[] =>
		Array.from({ length: Math.floor(next() * 6) }, () => ({ text: pick(texts), url: pick(urls) }));

	const incremental = new LinkIndex();
	const truth = new Map<string, { mtime: number; pairs: LinkPair[] }>();
	let paths = ["a.md", "b.md", "c.md", "d.md"];

	for (let step = 0; step < 500; step++) {
		const roll = next();
		const path = pick(paths);
		if (roll < 0.6) {
			const pairs = randomPairs();
			incremental.setFile(path, step, pairs);
			truth.set(path, { mtime: step, pairs });
		} else if (roll < 0.8) {
			incremental.removeFile(path);
			truth.delete(path);
		} else {
			const renamed = `r${step}.md`;
			incremental.renameFile(path, renamed);
			const entry = truth.get(path);
			truth.delete(path);
			if (entry) truth.set(renamed, entry);
			paths = paths.map((p) => (p === path ? renamed : p));
		}

		const rebuilt = new LinkIndex();
		for (const [p, { mtime, pairs }] of truth) rebuilt.setFile(p, mtime, pairs);
		assert.deepEqual(incremental.snapshot(), rebuilt.snapshot(), `diverged at step ${step}`);
		assert.equal(incremental.entryCount, rebuilt.entryCount);
	}
});

test("pairs are deduped per note", () => {
	const index = new LinkIndex();
	index.setFile("a.md", 1, [
		{ text: "Docs", url: "https://a.com" },
		{ text: "docs", url: "https://a.com/" },
	]);
	const [entry] = [...index.entries()];
	assert.deepEqual(entry.summary().urls, [{ url: "https://a.com", notes: 1, lastUsed: 1 }]);
});

test("removing the last note drops the entry", () => {
	const index = new LinkIndex();
	index.setFile("a.md", 1, [{ text: "Docs", url: "https://a.com" }]);
	index.setFile("a.md", 2, []);
	assert.equal(index.entryCount, 0);
	assert.equal(index.has("a.md"), false);
});

test("summaries reflect updates", () => {
	const index = new LinkIndex();
	index.setFile("a.md", 1, [{ text: "Docs", url: "https://a.com" }]);
	const [entry] = [...index.entries()];
	assert.equal(entry.summary().urls[0].lastUsed, 1);
	index.setFile("b.md", 5, [{ text: "Docs", url: "https://a.com" }]);
	assert.deepEqual(entry.summary().urls, [{ url: "https://a.com", notes: 2, lastUsed: 5 }]);
});

test("pairFilter applies the ignore lists", () => {
	const keep = pairFilter({ ignoredTexts: ["Click here", ""], ignoredDomains: ["*.corp.com"] });
	assert.equal(keep({ text: "click  HERE", url: "https://x.com" }), false);
	assert.equal(keep({ text: "Wiki", url: "https://wiki.corp.com/a" }), false);
	assert.equal(keep({ text: "Wiki", url: "https://corp.com/a" }), true);
});
