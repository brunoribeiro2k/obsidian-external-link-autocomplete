/*
 * The in-memory link index. Pure: no `obsidian` import, so incremental
 * updates can be checked against full rebuilds under Node.
 *
 * Per-file contributions are the source of truth. Updating a file subtracts
 * its old pairs and adds the new ones, so it costs O(links in that file).
 * Pairs are deduped per note: a note that repeats a link counts once.
 */

import type { EntrySummary, RankEntry, UrlInfo } from "./ranking.ts";
import { domainMatcher, fold, hostOf, normUrl, stripMarkdown } from "./text.ts";

/** One link as indexed: the raw text and the destination. */
export interface LinkPair {
	text: string;
	url: string;
}

interface StoredPair extends LinkPair {
	key: string;
	urlKey: string;
}

interface FileEntry {
	mtime: number;
	/** Distinct by `key` and `urlKey`. */
	pairs: StoredPair[];
}

/**
 * One URL under one text. Parallel arrays, one slot per note: `paths[i]`
 * wrote the text as `texts[i]` and the URL as `urls[i]`. Arrays rather than
 * maps keep the per-URL cost low, and these lists are almost always short.
 */
interface UrlStat {
	paths: string[];
	texts: string[];
	urls: string[];
}

class Aggregate implements RankEntry {
	readonly key: string;
	readonly urls = new Map<string, UrlStat>();
	private cached: EntrySummary | null = null;

	constructor(
		key: string,
		private readonly mtimeOf: (path: string) => number,
	) {
		this.key = key;
	}

	invalidate(): void {
		this.cached = null;
	}

	summary(): EntrySummary {
		if (this.cached) return this.cached;
		const texts: string[] = [];
		const urls: UrlInfo[] = [];
		for (const stat of this.urls.values()) {
			let lastUsed = 0;
			for (const path of stat.paths) lastUsed = Math.max(lastUsed, this.mtimeOf(path));
			urls.push({ url: mostFrequent(stat.urls), notes: stat.paths.length, lastUsed });
			texts.push(...stat.texts);
		}
		const text = mostFrequent(texts);
		this.cached = { text, display: stripMarkdown(text), urls };
		return this.cached;
	}
}

/** The most common value; ties go to the lexically smallest, for stability. */
function mostFrequent(values: string[]): string {
	if (values.length === 1) return values[0];
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best = "";
	let bestCount = -1;
	for (const [value, count] of counts) {
		if (count > bestCount || (count === bestCount && value < best)) {
			best = value;
			bestCount = count;
		}
	}
	return best;
}

export class LinkIndex {
	private readonly files = new Map<string, FileEntry>();
	private readonly aggregates = new Map<string, Aggregate>();
	private readonly mtimeOf = (path: string): number => this.files.get(path)?.mtime ?? 0;

	/** Replaces everything indexed for `path` with `pairs`. */
	setFile(path: string, mtime: number, pairs: LinkPair[]): void {
		this.removeFile(path);
		const seen = new Set<string>();
		const stored: StoredPair[] = [];
		for (const { text, url } of pairs) {
			const key = fold(stripMarkdown(text));
			if (key.length === 0) continue;
			const urlKey = normUrl(url);
			const id = `${key}\0${urlKey}`;
			if (seen.has(id)) continue;
			seen.add(id);
			stored.push({ text, url, key, urlKey });
		}
		if (stored.length === 0) return;
		this.files.set(path, { mtime, pairs: stored });
		for (const pair of stored) this.add(path, pair);
	}

	removeFile(path: string): void {
		const entry = this.files.get(path);
		if (!entry) return;
		this.files.delete(path);
		for (const pair of entry.pairs) this.subtract(path, pair);
	}

	renameFile(oldPath: string, newPath: string): void {
		const entry = this.files.get(oldPath);
		if (!entry) return;
		this.setFile(newPath, entry.mtime, entry.pairs);
		this.removeFile(oldPath);
	}

	clear(): void {
		this.files.clear();
		this.aggregates.clear();
	}

	has(path: string): boolean {
		return this.files.has(path);
	}

	/** Paths with at least one indexed link. */
	paths(): string[] {
		return [...this.files.keys()];
	}

	get fileCount(): number {
		return this.files.size;
	}

	get entryCount(): number {
		return this.aggregates.size;
	}

	entries(): Iterable<RankEntry> {
		return this.aggregates.values();
	}

	/** A canonical, order-independent dump of the aggregates, for tests. */
	snapshot(): Record<string, Record<string, string[]>> {
		const out: Record<string, Record<string, string[]>> = {};
		for (const key of [...this.aggregates.keys()].sort()) {
			const aggregate = this.aggregates.get(key);
			if (!aggregate) continue;
			const urls: Record<string, string[]> = {};
			for (const urlKey of [...aggregate.urls.keys()].sort()) {
				const stat = aggregate.urls.get(urlKey);
				if (!stat) continue;
				urls[urlKey] = stat.paths
					.map((path, i) => `${path} ${this.files.get(path)?.mtime} ${stat.texts[i]} ${stat.urls[i]}`)
					.sort();
			}
			out[key] = urls;
		}
		return out;
	}

	private add(path: string, pair: StoredPair): void {
		let aggregate = this.aggregates.get(pair.key);
		if (!aggregate) {
			aggregate = new Aggregate(pair.key, this.mtimeOf);
			this.aggregates.set(pair.key, aggregate);
		}
		const stat = aggregate.urls.get(pair.urlKey);
		if (stat) {
			stat.paths.push(path);
			stat.texts.push(pair.text);
			stat.urls.push(pair.url);
		} else {
			// Literals start at their exact size; a first `push` would reserve
			// room for many more, and most URLs only ever have one note.
			aggregate.urls.set(pair.urlKey, { paths: [path], texts: [pair.text], urls: [pair.url] });
		}
		aggregate.invalidate();
	}

	private subtract(path: string, pair: StoredPair): void {
		const aggregate = this.aggregates.get(pair.key);
		const stat = aggregate?.urls.get(pair.urlKey);
		if (!aggregate || !stat) return;
		const at = stat.paths.indexOf(path);
		if (at >= 0) {
			stat.paths.splice(at, 1);
			stat.texts.splice(at, 1);
			stat.urls.splice(at, 1);
		}
		if (stat.paths.length === 0) aggregate.urls.delete(pair.urlKey);
		if (aggregate.urls.size === 0) this.aggregates.delete(pair.key);
		else aggregate.invalidate();
	}
}

export interface PairFilterOptions {
	ignoredTexts: string[];
	ignoredDomains: string[];
}

/** Builds the index-time filter for the ignore lists. */
export function pairFilter(options: PairFilterOptions): (pair: LinkPair) => boolean {
	const texts = new Set(options.ignoredTexts.map((text) => fold(text)).filter((text) => text.length > 0));
	const ignoredHost = domainMatcher(options.ignoredDomains);
	return (pair) => !texts.has(fold(stripMarkdown(pair.text))) && !ignoredHost(hostOf(pair.url));
}
