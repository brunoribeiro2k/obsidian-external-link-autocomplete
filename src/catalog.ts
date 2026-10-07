/*
 * Groups the index for the link browser. Pure: no `obsidian` import.
 *
 * A variant is one text and URL pair, keyed like the index (folded text,
 * normalized URL). Grouped by URL, a group lists the texts used for one URL;
 * grouped by text, it lists the URLs one text points at.
 */

import type { PairStat } from "./index.ts";
import type { Occurrence } from "./scanner.ts";
import { fold, mostFrequent, normUrl, stripMarkdown } from "./text.ts";

export type Grouping = "url" | "text";
export type CatalogSort = "notes" | "name" | "recent";

export interface CatalogOptions {
	grouping: Grouping;
	sort: CatalogSort;
	/** Keeps groups with a text or URL containing this, folded. */
	filter: string;
	/** Keeps groups with more than one variant. */
	onlyInconsistent: boolean;
}

export interface CatalogVariant {
	/** Unique across the catalog. */
	id: string;
	key: string;
	urlKey: string;
	/** The most common spelling of the text. */
	text: string;
	/** The most common spelling of the URL. */
	url: string;
	/** Notes using the pair, sorted. */
	paths: string[];
}

export interface CatalogGroup {
	id: string;
	/** The most common URL spelling (by URL) or text (by text) in the group. */
	label: string;
	/** Most notes first. */
	variants: CatalogVariant[];
	/** Distinct notes across the variants. */
	notes: number;
	/** Latest `mtime` of those notes. */
	lastUsed: number;
}

export function buildCatalog(
	stats: Iterable<PairStat>,
	mtimeOf: (path: string) => number,
	options: CatalogOptions,
): CatalogGroup[] {
	const byUrl = options.grouping === "url";
	const buckets = new Map<string, { variants: CatalogVariant[]; spellings: string[] }>();
	for (const stat of stats) {
		const groupKey = byUrl ? stat.urlKey : stat.key;
		let bucket = buckets.get(groupKey);
		if (!bucket) {
			bucket = { variants: [], spellings: [] };
			buckets.set(groupKey, bucket);
		}
		bucket.variants.push({
			id: `${stat.key}\0${stat.urlKey}`,
			key: stat.key,
			urlKey: stat.urlKey,
			text: mostFrequent(stat.texts),
			url: mostFrequent(stat.urls),
			paths: [...stat.paths].sort(),
		});
		bucket.spellings.push(...(byUrl ? stat.urls : stat.texts));
	}

	const query = fold(options.filter);
	const groups: CatalogGroup[] = [];
	for (const [groupKey, { variants, spellings }] of buckets) {
		if (options.onlyInconsistent && variants.length < 2) continue;
		if (query.length > 0 && !variants.some((variant) => variantMatches(variant, query))) continue;
		const paths = new Set(variants.flatMap((variant) => variant.paths));
		let lastUsed = 0;
		for (const path of paths) lastUsed = Math.max(lastUsed, mtimeOf(path));
		variants.sort((a, b) => b.paths.length - a.paths.length || compareText(variantLabel(a, byUrl), variantLabel(b, byUrl)));
		groups.push({ id: `${options.grouping}:${groupKey}`, label: mostFrequent(spellings), variants, notes: paths.size, lastUsed });
	}

	const name = (group: CatalogGroup): string => (byUrl ? group.label : stripMarkdown(group.label));
	const byName = (a: CatalogGroup, b: CatalogGroup): number => compareText(name(a), name(b));
	if (options.sort === "name") groups.sort(byName);
	else if (options.sort === "recent") groups.sort((a, b) => b.lastUsed - a.lastUsed || byName(a, b));
	else groups.sort((a, b) => b.notes - a.notes || byName(a, b));
	return groups;
}

function variantMatches(variant: CatalogVariant, query: string): boolean {
	return variant.key.includes(query) || fold(variant.url).includes(query);
}

/** What a variant row shows: its text when grouped by URL, its URL otherwise. */
function variantLabel(variant: CatalogVariant, byUrl: boolean): string {
	return byUrl ? stripMarkdown(variant.text) : variant.url;
}

function compareText(a: string, b: string): number {
	const folded = fold(a).localeCompare(fold(b));
	return folded !== 0 ? folded : a.localeCompare(b);
}

/** Whether a scanned link is an instance of the variant. */
export function isVariantOf(occurrence: Occurrence, variant: Pick<CatalogVariant, "key" | "urlKey">): boolean {
	return normUrl(occurrence.url) === variant.urlKey && fold(stripMarkdown(occurrence.text)) === variant.key;
}

/**
 * A line cut down to the link and up to `context` characters on each side,
 * with `…` where it was cut.
 */
export function excerpt(line: string, start: number, end: number, context = 40): { before: string; match: string; after: string } {
	const from = Math.max(0, start - context);
	const to = Math.min(line.length, end + context);
	const before = line.slice(from, start).trimStart();
	const after = line.slice(end, to).trimEnd();
	return {
		before: from > 0 ? `…${before}` : before,
		match: line.slice(start, end),
		after: to < line.length ? `${after}…` : after,
	};
}
