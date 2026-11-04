/*
 * The index as compact data for scripts and agents: `query()` for grouped
 * counts, `rows()` for a flat table. No `obsidian` import, so everything here
 * is unit-testable under Node.
 */

import { buildCatalog, type CatalogGroup, type CatalogSort, type CatalogVariant, type Grouping } from "./catalog.ts";
import type { PairStat } from "./index.ts";
import { domainMatcher, fold, hostOf, mostFrequent } from "./text.ts";

/** The link browser's groupings, plus one group per host. */
export type QueryGrouping = Grouping | "domain";

/** `query()`'s options. Every field is optional; callers aren't type-checked, so they're validated. */
export interface QueryOptions {
	/** Default "url". By "domain", a group is a host and its variants are its URLs. */
	grouping?: QueryGrouping;
	/** Default "notes". */
	sort?: CatalogSort;
	/** Folded substring over texts and URLs, as in the link browser. Default none. */
	filter?: string;
	/** Keeps groups with more than one variant. Default false; not with "domain" grouping. */
	onlyInconsistent?: boolean;
	/** Keeps groups used in at least this many notes. Default all. */
	minNotes?: number;
	/** Most groups to return. Default all. */
	limit?: number;
	/** Most variants per group; a group cut short says how many it has in `variantCount`. Default all. */
	variantLimit?: number;
	/** Each variant's notes: false for none (default), true for all, a number for at most that many. */
	includePaths?: boolean | number;
	/** Only links in notes under this folder, or any of these. Default the whole vault. */
	folder?: string | string[];
	/** Only links to this host or its subdomains, or any of these; `*` globs. Default all. */
	domain?: string | string[];
}

/** `rows()`'s options, validated like `QueryOptions`. */
export interface RowsOptions {
	/** Only links in notes under this folder, or any of these. Default the whole vault. */
	folder?: string | string[];
	/** Only links to this host or its subdomains, or any of these; `*` globs. Default all. */
	domain?: string | string[];
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
	/** All the group's variants, only when `variantLimit` cut the list. */
	variantCount?: number;
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

const GROUPINGS: readonly QueryGrouping[] = ["url", "text", "domain"];
const SORTS: readonly CatalogSort[] = ["notes", "name", "recent"];

/**
 * Grouped, filtered and sorted index data, with counts in place of note
 * lists. `folder` and `domain` scope the links before grouping, so counts,
 * variants, `onlyInconsistent` and `minNotes` only reflect those links.
 */
export function queryLinks(stats: Iterable<PairStat>, mtimeOf: (path: string) => number, options: unknown = {}): QueryResult {
	const query = parseQueryOptions(options);
	const scoped = query.keep ? scopeStats(stats, query.keep) : stats;
	const all =
		query.grouping === "domain"
			? domainGroups(scoped, mtimeOf, query.sort, query.filter)
			: buildCatalog(scoped, mtimeOf, {
					grouping: query.grouping,
					sort: query.sort,
					filter: query.filter,
					onlyInconsistent: query.onlyInconsistent,
				});
	const groups = query.minNotes > 0 ? all.filter((group) => group.notes >= query.minNotes) : all;
	return {
		total: groups.length,
		groups: groups.slice(0, query.limit).map((group) => {
			const out: QueryGroup = { label: group.label, notes: group.notes, variants: [] };
			if (group.variants.length > query.variantLimit) out.variantCount = group.variants.length;
			out.variants = group.variants.slice(0, query.variantLimit).map((variant) => {
				const row: QueryVariant = { text: variant.text, url: variant.url, notes: variant.paths.length };
				if (query.includePaths > 0) row.paths = variant.paths.slice(0, query.includePaths);
				return row;
			});
			return out;
		}),
	};
}

/** Every link in every note (or under `folder`, to `domain`), one row each, sorted by note. */
export function linkRows(stats: Iterable<PairStat>, mtimeOf: (path: string) => number, options: unknown = {}): LinkRow[] {
	const parsed = optionsObject(options, "rows", ["folder", "domain"]);
	const keep = scopeFilter(parsed.folder, parsed.domain);
	const rows: LinkRow[] = [];
	for (const stat of stats) {
		for (let i = 0; i < stat.paths.length; i++) {
			const path = stat.paths[i];
			const url = stat.urls[i];
			if (keep && !keep(path, url)) continue;
			rows.push({ text: stat.texts[i], url, domain: hostOf(url), path, mtime: mtimeOf(path) });
		}
	}
	return rows.sort((a, b) => compare(a.path, b.path) || compare(a.url, b.url) || compare(a.text, b.text));
}

/** Fills in defaults, and throws a `TypeError` naming the first invalid option. */
export function parseQueryOptions(input: unknown): {
	grouping: QueryGrouping;
	sort: CatalogSort;
	filter: string;
	onlyInconsistent: boolean;
	minNotes: number;
	limit: number;
	variantLimit: number;
	includePaths: number;
	/** Which links count, by note path and URL; null for all. */
	keep: ScopeFilter | null;
} {
	const options = optionsObject(input, "query", [
		"grouping",
		"sort",
		"filter",
		"onlyInconsistent",
		"minNotes",
		"limit",
		"variantLimit",
		"includePaths",
		"folder",
		"domain",
	]);

	const grouping = options.grouping ?? "url";
	if (!GROUPINGS.includes(grouping as QueryGrouping)) throw new TypeError(`grouping must be one of ${GROUPINGS.join(", ")}`);
	const sort = options.sort ?? "notes";
	if (!SORTS.includes(sort as CatalogSort)) throw new TypeError(`sort must be one of ${SORTS.join(", ")}`);
	const filter = options.filter ?? "";
	if (typeof filter !== "string") throw new TypeError("filter must be a string");
	const onlyInconsistent = options.onlyInconsistent ?? false;
	if (typeof onlyInconsistent !== "boolean") throw new TypeError("onlyInconsistent must be a boolean");
	if (onlyInconsistent && grouping === "domain") throw new TypeError('onlyInconsistent doesn\'t apply to "domain" grouping');
	const minNotes = options.minNotes ?? 0;
	if (!isCount(minNotes)) throw new TypeError("minNotes must be a non-negative integer");

	const limit = options.limit ?? Infinity;
	if (limit !== Infinity && !isCount(limit)) throw new TypeError("limit must be a non-negative integer");
	const variantLimit = options.variantLimit ?? Infinity;
	if (variantLimit !== Infinity && !isCount(variantLimit)) throw new TypeError("variantLimit must be a non-negative integer");
	const rawPaths = options.includePaths ?? false;
	if (typeof rawPaths !== "boolean" && !isCount(rawPaths)) {
		throw new TypeError("includePaths must be a boolean or a non-negative integer");
	}
	const includePaths = rawPaths === true ? Infinity : rawPaths === false ? 0 : rawPaths;

	return {
		grouping: grouping as QueryGrouping,
		sort: sort as CatalogSort,
		filter,
		onlyInconsistent,
		minNotes,
		limit,
		variantLimit,
		includePaths,
		keep: scopeFilter(options.folder, options.domain),
	};
}

type ScopeFilter = (path: string, url: string) => boolean;

/** The `folder` and `domain` options as one predicate over a link's note and URL, or null for all. */
function scopeFilter(folder: unknown, domain: unknown): ScopeFilter | null {
	const inFolder = parseFolder(folder);
	const inDomain = parseDomain(domain);
	if (!inFolder && !inDomain) return null;
	return (path, url) => (!inFolder || inFolder(path)) && (!inDomain || inDomain(hostOf(url)));
}

/**
 * Matches hosts equal to one of the domains or under it (`github.com` also
 * matches `gist.github.com`), with `*` globbing as in the ignore list, or
 * null when there's no domain option.
 */
export function parseDomain(value: unknown): ((host: string) => boolean) | null {
	if (value === undefined) return null;
	const list = Array.isArray(value) ? (value as unknown[]) : [value];
	if (list.length === 0) throw new TypeError("domain must not be an empty list; leave it out for every domain");
	const domains = list.map((domain) => {
		if (typeof domain !== "string") throw new TypeError("domain must be a string or a list of strings");
		const normalized = domain.trim().toLowerCase().replace(/^\.|\.$/g, "");
		if (normalized.length === 0) throw new TypeError("domain must not be empty; leave it out for every domain");
		if (/[/:@\s]/.test(normalized)) throw new TypeError(`domain "${domain}" must be a host name, like example.com`);
		return normalized;
	});
	return domainMatcher(domains.flatMap((domain) => [domain, `*.${domain}`]));
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

/** The stats restricted to the links `keep` accepts, leaving out pairs with none. */
function* scopeStats(stats: Iterable<PairStat>, keep: ScopeFilter): Generator<PairStat> {
	for (const stat of stats) {
		const kept: number[] = [];
		for (let i = 0; i < stat.paths.length; i++) if (keep(stat.paths[i], stat.urls[i])) kept.push(i);
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

/**
 * One group per host, its variants the host's URLs (each with its most used
 * text and spelling), most notes first. `filter` keeps a host when any of its
 * links' texts or URLs contains it, as the catalog does for its groups.
 */
function domainGroups(
	stats: Iterable<PairStat>,
	mtimeOf: (path: string) => number,
	sort: CatalogSort,
	filter: string,
): CatalogGroup[] {
	const query = fold(filter);
	const byUrl = new Map<string, { paths: Set<string>; texts: string[]; urls: string[]; matches: boolean }>();
	for (const stat of stats) {
		let entry = byUrl.get(stat.urlKey);
		if (!entry) {
			entry = { paths: new Set(), texts: [], urls: [], matches: false };
			byUrl.set(stat.urlKey, entry);
		}
		for (const path of stat.paths) entry.paths.add(path);
		entry.texts.push(...stat.texts);
		entry.urls.push(...stat.urls);
		if (query.length > 0 && !entry.matches) {
			entry.matches = stat.key.includes(query) || stat.urls.some((url) => fold(url).includes(query));
		}
	}

	const byHost = new Map<string, { variants: CatalogVariant[]; matches: boolean }>();
	for (const [urlKey, entry] of byUrl) {
		const host = hostOf(urlKey);
		let bucket = byHost.get(host);
		if (!bucket) {
			bucket = { variants: [], matches: false };
			byHost.set(host, bucket);
		}
		bucket.variants.push({
			id: urlKey,
			key: "",
			urlKey,
			text: mostFrequent(entry.texts),
			url: mostFrequent(entry.urls),
			paths: [...entry.paths].sort(),
		});
		bucket.matches ||= entry.matches;
	}

	const groups: CatalogGroup[] = [];
	for (const [host, { variants, matches }] of byHost) {
		if (query.length > 0 && !matches) continue;
		const paths = new Set(variants.flatMap((variant) => variant.paths));
		let lastUsed = 0;
		for (const path of paths) lastUsed = Math.max(lastUsed, mtimeOf(path));
		variants.sort((a, b) => b.paths.length - a.paths.length || compare(a.url, b.url));
		groups.push({ id: `domain:${host}`, label: host, variants, notes: paths.size, lastUsed });
	}
	const byName = (a: CatalogGroup, b: CatalogGroup): number => compare(a.label, b.label);
	if (sort === "name") groups.sort(byName);
	else if (sort === "recent") groups.sort((a, b) => b.lastUsed - a.lastUsed || byName(a, b));
	else groups.sort((a, b) => b.notes - a.notes || byName(a, b));
	return groups;
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
