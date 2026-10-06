/*
 * Orders index entries for a query. Pure: no `obsidian` import.
 *
 * Tiers come first (exact > prefix > word-start prefix > fuzzy), so a better
 * match always beats a more popular one. Inside a tier, a usage score mixes
 * the number of distinct notes and how recently those notes were touched.
 */

import { fold, foldWithMap, mapMatches, type Matches } from "./text.ts";

export type RankingMode = "balanced" | "frequency" | "recency";
export type MultiUrlMode = "all" | "recent" | "used";

export const Tier = {
	Exact: 0,
	Prefix: 1,
	WordPrefix: 2,
	Fuzzy: 3,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export interface UrlInfo {
	url: string;
	/** Distinct notes that use this text with this URL. */
	notes: number;
	/** Latest mtime among those notes, in ms. */
	lastUsed: number;
}

export interface EntrySummary {
	/** Raw text to insert, in its most frequent spelling. */
	text: string;
	/** `text` with Markdown stripped, for display. Folds to the entry key. */
	display: string;
	urls: UrlInfo[];
}

/** What ranking needs from the index: a folded key and a lazy summary. */
export interface RankEntry {
	readonly key: string;
	summary(): EntrySummary;
}

export interface Suggestion extends UrlInfo {
	text: string;
	display: string;
	tier: Tier;
	/** Matched ranges on `display`, for highlighting. */
	matches: Matches;
}

export interface RankOptions {
	mode: RankingMode;
	multiUrl: MultiUrlMode;
	/** Maximum number of rows returned. */
	limit: number;
	now: number;
}

const HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many fuzzy matches are scored per query. */
const FUZZY_CAP = 200;

const WEIGHTS: Record<RankingMode, { frequency: number; recency: number }> = {
	balanced: { frequency: 1, recency: 1 },
	frequency: { frequency: 1, recency: 0 },
	recency: { frequency: 0, recency: 1 },
};

interface Candidate {
	entry: RankEntry;
	tier: Tier;
	/** Matched ranges on the folded key. */
	matches: Matches;
}

export function rank(query: string, entries: Iterable<RankEntry>, options: RankOptions): Suggestion[] {
	const q = fold(query);
	if (q.length === 0 || options.limit <= 0) return [];

	const candidates: Candidate[] = [];
	const rest: RankEntry[] = [];
	for (const entry of entries) {
		const candidate = matchStrict(entry, q);
		if (candidate) candidates.push(candidate);
		else rest.push(entry);
	}
	// Fuzzy rows sort below every stricter row, so they only matter while the
	// stricter tiers leave room. Each entry yields at least one row.
	if (candidates.length < options.limit) {
		let fuzzy = 0;
		for (const entry of rest) {
			const matches = subsequence(entry.key, q);
			if (!matches) continue;
			candidates.push({ entry, tier: Tier.Fuzzy, matches });
			if (++fuzzy >= FUZZY_CAP) break;
		}
	}

	const weights = WEIGHTS[options.mode];
	const score = (url: UrlInfo): number =>
		weights.frequency * Math.log(1 + url.notes) +
		weights.recency * Math.pow(0.5, Math.max(0, options.now - url.lastUsed) / HALF_LIFE_MS);

	const ranked = candidates.map((candidate) => {
		const summary = candidate.entry.summary();
		const urls = pickUrls(summary.urls, options.multiUrl, score);
		return { candidate, summary, urls, best: urls.length > 0 ? score(urls[0]) : 0 };
	});
	ranked.sort(
		(a, b) =>
			a.candidate.tier - b.candidate.tier ||
			b.best - a.best ||
			a.summary.display.length - b.summary.display.length ||
			compare(a.candidate.entry.key, b.candidate.entry.key),
	);

	const out: Suggestion[] = [];
	for (const { candidate, summary, urls } of ranked) {
		if (urls.length === 0) continue;
		const { folded, map } = foldWithMap(summary.display);
		const matches =
			folded === candidate.entry.key ? mapMatches(candidate.matches, map, summary.display) : [];
		for (const url of urls) {
			out.push({ ...url, text: summary.text, display: summary.display, tier: candidate.tier, matches });
			if (out.length >= options.limit) return out;
		}
	}
	return out;
}

function matchStrict(entry: RankEntry, q: string): Candidate | null {
	const key = entry.key;
	if (key === q) return { entry, tier: Tier.Exact, matches: [[0, q.length]] };
	if (key.startsWith(q)) return { entry, tier: Tier.Prefix, matches: [[0, q.length]] };
	let at = key.indexOf(q, 1);
	while (at > 0) {
		if (!isWordChar(key[at - 1])) {
			return { entry, tier: Tier.WordPrefix, matches: [[at, at + q.length]] };
		}
		at = key.indexOf(q, at + 1);
	}
	return null;
}

function isWordChar(char: string): boolean {
	return /[\p{L}\p{N}]/u.test(char);
}

/** Matched ranges if every character of `q` appears in order in `key`. */
function subsequence(key: string, q: string): Matches | null {
	const matches: Matches = [];
	let from = 0;
	for (const char of q) {
		const at = key.indexOf(char, from);
		if (at < 0) return null;
		const last = matches[matches.length - 1];
		if (last && last[1] === at) last[1] = at + char.length;
		else matches.push([at, at + char.length]);
		from = at + char.length;
	}
	return matches;
}

function pickUrls(urls: UrlInfo[], mode: MultiUrlMode, score: (url: UrlInfo) => number): UrlInfo[] {
	if (urls.length === 0) return urls;
	if (mode === "recent") {
		return [best(urls, (a, b) => b.lastUsed - a.lastUsed || score(b) - score(a))];
	}
	if (mode === "used") {
		return [best(urls, (a, b) => b.notes - a.notes || score(b) - score(a))];
	}
	return [...urls].sort((a, b) => score(b) - score(a) || compare(a.url, b.url));
}

function best(urls: UrlInfo[], order: (a: UrlInfo, b: UrlInfo) => number): UrlInfo {
	return [...urls].sort((a, b) => order(a, b) || compare(a.url, b.url))[0];
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
