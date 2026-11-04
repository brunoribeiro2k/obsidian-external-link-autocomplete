/*
 * The index as compact data for scripts and agents: `query()` for grouped
 * counts, `rows()` for a flat table. No `obsidian` import, so everything here
 * is unit-testable under Node.
 */

import { buildCatalog, type CatalogOptions, type CatalogSort, type Grouping } from "./catalog.ts";
import type { PairStat } from "./index.ts";
import { hostOf } from "./text.ts";

/** `query()`'s options. Every field is optional; callers aren't type-checked, so they're validated. */
export interface QueryOptions {
	/** Default "url". */
	grouping?: Grouping;
	/** Default "notes". */
	sort?: CatalogSort;
	/** Folded substring over texts and URLs, as in the link browser. Default none. */
	filter?: string;
	/** Keeps groups with more than one variant. Default false. */
	onlyInconsistent?: boolean;
	/** Most groups to return. Default all. */
	limit?: number;
	/** Each variant's notes: false for none (default), true for all, a number for at most that many. */
	includePaths?: boolean | number;
}

export interface QueryVariant {
	text: string;
	url: string;
	/** Notes using the pair. */
	notes: number;
	/** Only with `includePaths`; sorted, and capped when it's a number. */
	paths?: string[];
}

export interface QueryGroup {
	label: string;
	/** Distinct notes across the variants. */
	notes: number;
	variants: QueryVariant[];
}

export interface QueryResult {
	/** Matching groups before `limit`. */
	total: number;
	groups: QueryGroup[];
}

/** One link in one note, as written there. */
export interface LinkRow {
	text: string;
	url: string;
	/** The URL's bare host, lowercased. */
	domain: string;
	path: string;
	/** The note's modification time, in milliseconds since the epoch. */
	mtime: number;
}

const GROUPINGS: readonly Grouping[] = ["url", "text"];
const SORTS: readonly CatalogSort[] = ["notes", "name", "recent"];

/** Grouped, filtered and sorted index data, with counts in place of note lists. */
export function queryLinks(stats: Iterable<PairStat>, mtimeOf: (path: string) => number, options: unknown = {}): QueryResult {
	const { catalog, limit, includePaths } = parseQueryOptions(options);
	const groups = buildCatalog(stats, mtimeOf, catalog);
	return {
		total: groups.length,
		groups: groups.slice(0, limit).map((group) => ({
			label: group.label,
			notes: group.notes,
			variants: group.variants.map((variant) => {
				const out: QueryVariant = { text: variant.text, url: variant.url, notes: variant.paths.length };
				if (includePaths > 0) out.paths = variant.paths.slice(0, includePaths);
				return out;
			}),
		})),
	};
}

/** Every link in every note, one row each, sorted by note. */
export function linkRows(stats: Iterable<PairStat>, mtimeOf: (path: string) => number): LinkRow[] {
	const rows: LinkRow[] = [];
	for (const stat of stats) {
		for (let i = 0; i < stat.paths.length; i++) {
			const path = stat.paths[i];
			const url = stat.urls[i];
			rows.push({ text: stat.texts[i], url, domain: hostOf(url), path, mtime: mtimeOf(path) });
		}
	}
	return rows.sort((a, b) => compare(a.path, b.path) || compare(a.url, b.url) || compare(a.text, b.text));
}

/** Fills in defaults, and throws a `TypeError` naming the first invalid option. */
export function parseQueryOptions(input: unknown): { catalog: CatalogOptions; limit: number; includePaths: number } {
	if (input === undefined || input === null) input = {};
	if (typeof input !== "object" || Array.isArray(input)) throw new TypeError("query options must be an object");
	const options = input as Record<string, unknown>;
	const known = new Set(["grouping", "sort", "filter", "onlyInconsistent", "limit", "includePaths"]);
	for (const name of Object.keys(options)) {
		if (!known.has(name)) throw new TypeError(`unknown query option "${name}"`);
	}

	const grouping = options.grouping ?? "url";
	if (!GROUPINGS.includes(grouping as Grouping)) throw new TypeError(`grouping must be one of ${GROUPINGS.join(", ")}`);
	const sort = options.sort ?? "notes";
	if (!SORTS.includes(sort as CatalogSort)) throw new TypeError(`sort must be one of ${SORTS.join(", ")}`);
	const filter = options.filter ?? "";
	if (typeof filter !== "string") throw new TypeError("filter must be a string");
	const onlyInconsistent = options.onlyInconsistent ?? false;
	if (typeof onlyInconsistent !== "boolean") throw new TypeError("onlyInconsistent must be a boolean");

	const limit = options.limit ?? Infinity;
	if (limit !== Infinity && !isCount(limit)) throw new TypeError("limit must be a non-negative integer");
	const rawPaths = options.includePaths ?? false;
	if (typeof rawPaths !== "boolean" && !isCount(rawPaths)) {
		throw new TypeError("includePaths must be a boolean or a non-negative integer");
	}
	const includePaths = rawPaths === true ? Infinity : rawPaths === false ? 0 : rawPaths;

	return {
		catalog: { grouping: grouping as Grouping, sort: sort as CatalogSort, filter, onlyInconsistent },
		limit,
		includePaths,
	};
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
