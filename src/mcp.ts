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
const DEFAULT_ROWS_LIMIT = 500;
const MAX_ROWS_LIMIT = 5000;

/**
 * A fresh schema per use: the host's JSON Schema conversion turns a reused
 * instance into a `$ref` to its first use, which not every client resolves.
 */
const count = (): z.ZodNumber => z.number().int().min(0);

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
			"Lists the external Markdown links ([text](https://…)) used across the Obsidian vault, grouped by URL or by text, " +
			"with how many notes use each. A group's variants are the distinct text and URL pairs in it, so a URL written " +
			"with several texts (or a text pointing to several URLs) has several variants. `total` counts every matching " +
			`group; at most \`limit\` (default ${DEFAULT_QUERY_LIMIT}) are returned.`,
		inputSchema: {
			grouping: z.enum(["url", "text"]).optional().describe('Group by "url" (default) or by link "text".'),
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
				.describe("Keeps only groups with more than one variant: URLs written with several texts, or texts with several URLs."),
			limit: count().optional().describe(`Most groups to return. Default ${DEFAULT_QUERY_LIMIT}.`),
			includePaths: z
				.union([z.boolean(), count()])
				.optional()
				.describe("Lists each variant's note paths: true for all, a number for at most that many. Default false."),
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
		callback: (args) =>
			Promise.resolve(
				respond(() =>
					plugin.query({
						...withoutUndefined(args),
						limit: (args.limit as number | undefined) ?? DEFAULT_QUERY_LIMIT,
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
			"A flat table for counting or SQL-style analysis. Page through it with offset and limit; `total` is the row count.",
		inputSchema: {
			offset: count().optional().describe("Rows to skip. Default 0."),
			limit: count()
				.max(MAX_ROWS_LIMIT)
				.optional()
				.describe(`Most rows to return, up to ${MAX_ROWS_LIMIT}. Default ${DEFAULT_ROWS_LIMIT}.`),
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
		callback: (args) =>
			Promise.resolve(
				respond(() => {
					const rows = plugin.rows();
					const offset = (args.offset as number | undefined) ?? 0;
					const limit = (args.limit as number | undefined) ?? DEFAULT_ROWS_LIMIT;
					return { total: rows.length, offset, rows: rows.slice(offset, offset + limit) };
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
