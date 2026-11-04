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
	/** Only links in notes under this folder, or any of these. Default the whole vault. */
	folder?: string | string[];
}

/** `rows()`'s options, validated like `QueryOptions`. */
export interface RowsOptions {
	/** Only links in notes under this folder, or any of these. Default the whole vault. */
	folder?: string | string[];
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

/**
 * Grouped, filtered and sorted index data, with counts in place of note
 * lists. A `folder` scopes the notes before grouping, so counts, variants and
 * `onlyInconsistent` only reflect those notes.
 */
export function queryLinks(stats: Iterable<PairStat>, mtimeOf: (path: string) => number, options: unknown = {}): QueryResult {
	const { catalog, limit, includePaths, inFolder } = parseQueryOptions(options);
	const groups = buildCatalog(inFolder ? scopeStats(stats, inFolder) : stats, mtimeOf, catalog);
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

/** Every link in every note (or in `folder`), one row each, sorted by note. */
export function linkRows(stats: Iterable<PairStat>, mtimeOf: (path: string) => number, options: unknown = {}): LinkRow[] {
	const inFolder = parseFolder(optionsObject(options, "rows", ["folder"]).folder);
	const rows: LinkRow[] = [];
	for (const stat of stats) {
		for (let i = 0; i < stat.paths.length; i++) {
			const path = stat.paths[i];
			if (inFolder && !inFolder(path)) continue;
			const url = stat.urls[i];
			rows.push({ text: stat.texts[i], url, domain: hostOf(url), path, mtime: mtimeOf(path) });
		}
	}
	return rows.sort((a, b) => compare(a.path, b.path) || compare(a.url, b.url) || compare(a.text, b.text));
}

/** Fills in defaults, and throws a `TypeError` naming the first invalid option. */
export function parseQueryOptions(input: unknown): {
	catalog: CatalogOptions;
	limit: number;
	includePaths: number;
	/** Null for the whole vault. */
	inFolder: ((path: string) => boolean) | null;
} {
	const options = optionsObject(input, "query", [
		"grouping",
		"sort",
		"filter",
		"onlyInconsistent",
		"limit",
		"includePaths",
		"folder",
	]);

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
		inFolder: parseFolder(options.folder),
	};
}

/**
 * Matches paths under one or several folders, normalized like Obsidian's
 * `normalizePath` (slashes, leading and trailing `/`, NFC), or null when
 * there's no folder option.
 */
export function parseFolder(value: unknown): ((path: string) => boolean) | null {
	if (value === undefined) return null;
	const list = Array.isArray(value) ? (value as unknown[]) : [value];
	if (list.length === 0) throw new TypeError("folder must not be an empty list; leave it out for the whole vault");
	const folders = list.map((folder) => {
		if (typeof folder !== "string") throw new TypeError("folder must be a string or a list of strings");
		const normalized = folder.replace(/[\\/]+/g, "/").replace(/^\/|\/$/g, "").normalize("NFC");
		if (normalized.length === 0) throw new TypeError("folder must not be empty; leave it out for the whole vault");
		return normalized;
	});
	return (path) => folders.some((folder) => path === folder || path.startsWith(`${folder}/`));
}

/** The stats restricted to notes `keep` accepts, leaving out pairs with none. */
function* scopeStats(stats: Iterable<PairStat>, keep: (path: string) => boolean): Generator<PairStat> {
	for (const stat of stats) {
		const kept: number[] = [];
		for (let i = 0; i < stat.paths.length; i++) if (keep(stat.paths[i])) kept.push(i);
		if (kept.length === 0) continue;
		if (kept.length === stat.paths.length) {
			yield stat;
			continue;
		}
		yield {
			key: stat.key,
			urlKey: stat.urlKey,
			paths: kept.map((i) => stat.paths[i]),
			texts: kept.map((i) => stat.texts[i]),
			urls: kept.map((i) => stat.urls[i]),
		};
	}
}

/** The options as a record, throwing on a non-object or an unknown option. */
function optionsObject(input: unknown, what: string, known: readonly string[]): Record<string, unknown> {
	if (input === undefined || input === null) return {};
	if (typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${what} options must be an object`);
	const options = input as Record<string, unknown>;
	for (const name of Object.keys(options)) {
		if (!known.includes(name)) throw new TypeError(`unknown ${what} option "${name}"`);
	}
	return options;
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
