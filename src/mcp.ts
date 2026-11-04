/*
 * MCP tools over the link index, registered on Local REST API with MCP's
 * server when that plugin is installed. Optional: without it, nothing here
 * runs past `getAPI` returning undefined.
 */

import type { EventRef } from "obsidian";
import { getAPI, type LocalRestApiPublicApi, type McpToolResult } from "obsidian-local-rest-api";
import { z } from "zod";
import type ExternalLinkAutocompletePlugin from "./main.ts";

/** Fired by Local REST API whenever it (re)loads; a reload forgets extension tools. */
export const LOCAL_REST_API_LOADED = "obsidian-local-rest-api:loaded";

declare module "obsidian" {
	interface Workspace {
		on(name: typeof LOCAL_REST_API_LOADED, callback: () => unknown, ctx?: unknown): EventRef;
	}
}
/** `addMcpTool`'s definition form, with `structuredContent`, needs this. */
const EXTENSION_API_VERSION = 3;

export const QUERY_TOOL = "external_links_query";
export const ROWS_TOOL = "external_links_rows";

/** Groups returned when the caller sets no `limit`, so an agent's first call stays small. */
const DEFAULT_QUERY_LIMIT = 50;
/** Variants per group when the caller sets no `variantLimit`: a big site can have hundreds of URLs. */
const DEFAULT_VARIANT_LIMIT = 20;
const DEFAULT_ROWS_LIMIT = 500;
const MAX_ROWS_LIMIT = 5000;

/**
 * A fresh schema per use: the host's JSON Schema conversion turns a reused
 * instance into a `$ref` to its first use, which not every client resolves.
 */
const count = (): z.ZodNumber => z.number().int().min(0);
const folder = (): z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString>]>> =>
	z
		.union([z.string(), z.array(z.string())])
		.optional()
		.describe(
			'Only links in notes under this vault folder, or any of these folders, e.g. "daily/2026-10" or ["daily/2026-10", "daily/2026-11"]. ' +
				"Default the whole vault.",
		);
const domain = (): z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString>]>> =>
	z
		.union([z.string(), z.array(z.string())])
		.optional()
		.describe(
			'Only links to this host or its subdomains, or any of these, e.g. "github.com" (also gist.github.com) or "*.atlassian.net". ' +
				"Default every domain.",
		);

/**
 * Registers the tools, replacing any registered before. Returns the handle
 * to unregister them with, or null when Local REST API isn't there or is
 * too old.
 */
export function registerMcpTools(
	plugin: ExternalLinkAutocompletePlugin,
	previous: LocalRestApiPublicApi | null,
): LocalRestApiPublicApi | null {
	unregisterMcpTools(previous);
	let api: LocalRestApiPublicApi | undefined;
	try {
		api = getAPI(plugin.app, plugin.manifest, EXTENSION_API_VERSION);
	} catch {
		// An older Local REST API, or one still loading: its loaded event retries.
		return null;
	}
	if (!api) return null;

	api.addMcpTool({
		name: QUERY_TOOL,
		title: "Query external links",
		description:
			"Lists the external Markdown links ([text](https://…)) used across the Obsidian vault, grouped by URL, by text or by domain, " +
			"with how many notes use each. A group's variants are the distinct text and URL pairs in it, so a URL written " +
			"with several texts (or a text pointing to several URLs) has several variants; by domain, they're the site's URLs. " +
			"`folder` and `domain` scope the links before grouping, so counts, onlyInconsistent and minNotes reflect only those links. " +
			`\`total\` counts every matching group; at most \`limit\` (default ${DEFAULT_QUERY_LIMIT}) are returned, each with at most ` +
			`\`variantLimit\` (default ${DEFAULT_VARIANT_LIMIT}) variants; a cut group has \`variantCount\`. ` +
			"`indexing: true` means the index is still being built and the results are partial.",
		inputSchema: {
			grouping: z
				.enum(["url", "text", "domain"])
				.optional()
				.describe('Group by "url" (default), by link "text", or by "domain" (one group per host, its URLs as variants).'),
			sort: z
				.enum(["notes", "name", "recent"])
				.optional()
				.describe('"notes" (most notes first, default), "name" (A to Z) or "recent" (most recently edited notes first).'),
			filter: z
				.string()
				.optional()
				.describe("Keeps groups with a link text or URL containing this; case, accents and repeated spaces are ignored."),
			onlyInconsistent: z
				.boolean()
				.optional()
				.describe(
					"Keeps only groups with more than one variant: URLs written with several texts, or texts with several URLs. Not with domain grouping.",
				),
			minNotes: count().optional().describe("Keeps only groups used in at least this many notes."),
			limit: count().optional().describe(`Most groups to return. Default ${DEFAULT_QUERY_LIMIT}.`),
			variantLimit: count().optional().describe(`Most variants per group. Default ${DEFAULT_VARIANT_LIMIT}.`),
			includePaths: z
				.union([z.boolean(), count()])
				.optional()
				.describe("Lists each variant's note paths: true for all, a number for at most that many. Default false."),
			folder: folder(),
			domain: domain(),
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
		callback: (args) =>
			Promise.resolve(
				respond(() =>
					plugin.query({
						...withoutUndefined(args),
						limit: (args.limit as number | undefined) ?? DEFAULT_QUERY_LIMIT,
						variantLimit: (args.variantLimit as number | undefined) ?? DEFAULT_VARIANT_LIMIT,
					}),
				),
			),
	});

	api.addMcpTool({
		name: ROWS_TOOL,
		title: "List external links per note",
		description:
			"Lists every external Markdown link in the Obsidian vault, one row per link per note: " +
			"{ text, url, domain, path, mtime } (mtime in milliseconds since the epoch), as that note writes them, sorted by note path. " +
			"A flat table for counting or SQL-style analysis. Page through it with offset and limit; `total` is the row count. " +
			"`folder` keeps only notes under those folders, `domain` only links to those sites. " +
			"`indexing: true` means the index is still being built and the rows are partial.",
		inputSchema: {
			offset: count().optional().describe("Rows to skip. Default 0."),
			limit: count()
				.max(MAX_ROWS_LIMIT)
				.optional()
				.describe(`Most rows to return, up to ${MAX_ROWS_LIMIT}. Default ${DEFAULT_ROWS_LIMIT}.`),
			folder: folder(),
			domain: domain(),
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
		callback: (args) =>
			Promise.resolve(
				respond(() => {
					const { offset = 0, limit = DEFAULT_ROWS_LIMIT, ...options } = withoutUndefined(args) as {
						offset?: number;
						limit?: number;
						folder?: string | string[];
						domain?: string | string[];
					};
					const rows = plugin.rows(options);
					return { indexing: plugin.indexing, total: rows.length, offset, rows: rows.slice(offset, offset + limit) };
				}),
			),
	});

	return api;
}

/** Removes the tools, if they're registered. */
export function unregisterMcpTools(api: LocalRestApiPublicApi | null): void {
	if (!api) return;
	try {
		api.unregister();
	} catch {
		// Already gone with a reloaded Local REST API.
	}
}

/**
 * The result as JSON text and as `structuredContent`, for clients reading
 * either; a thrown error (an invalid option) becomes an `isError` result the
 * model can correct.
 */
function respond(run: () => object): McpToolResult {
	try {
		const result = run();
		return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text", text: message }], isError: true };
	}
}

/** MCP clients may send optional arguments as explicit undefined; `query()` only takes known keys. */
function withoutUndefined(args: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}
