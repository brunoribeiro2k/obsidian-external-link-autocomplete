import { App, normalizePath, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type ExternalLinkAutocompletePlugin from "./main.ts";
import type { CatalogSort, Grouping } from "./catalog.ts";
import type { MultiUrlMode, RankingMode } from "./ranking.ts";

export interface ExternalLinkSettings {
	minChars: number;
	ranking: RankingMode;
	multiUrl: MultiUrlMode;
	tabAccepts: boolean;
	showNoteCount: boolean;
	excludedFolders: string[];
	ignoredTexts: string[];
	ignoredDomains: string[];
	browserPlacement: "sidebar" | "tab";
	/** Set from the link browser's own controls, not the settings tab. */
	browserGrouping: Grouping;
	browserSort: CatalogSort;
	browserOnlyInconsistent: boolean;
}

export const DEFAULT_SETTINGS: ExternalLinkSettings = {
	minChars: 2,
	ranking: "balanced",
	multiUrl: "all",
	tabAccepts: true,
	showNoteCount: false,
	excludedFolders: [],
	ignoredTexts: ["here", "link", "this", "source", "click here"],
	ignoredDomains: [],
	browserPlacement: "sidebar",
	browserGrouping: "url",
	browserSort: "notes",
	browserOnlyInconsistent: false,
};

/** Which part of the plugin a settings change touches. */
export type SettingsImpact = "suggester" | "index" | "browser";

/** Settings edited as one entry per line in a text area. */
const LINE_LISTS = ["ignoredTexts", "ignoredDomains"] as const;
type LineListKey = (typeof LINE_LISTS)[number];
/** Control keys for excluded folders are `excludedFolders.<index>`. */
const FOLDER_KEY = "excludedFolders.";

function isLineList(key: string): key is LineListKey {
	return (LINE_LISTS as readonly string[]).includes(key);
}

function lines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/** Declarative settings tab, so every setting shows up in settings search. */
export class ExternalLinkSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: ExternalLinkAutocompletePlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const folders = this.plugin.settings.excludedFolders;
		return [
			{
				name: "Minimum characters",
				desc: "How many characters to type after the opening bracket before suggestions appear.",
				control: { type: "slider", key: "minChars", min: 1, max: 5, step: 1 },
			},
			{
				name: "Ranking",
				desc: "Within equally good matches, prefer links used in more notes, links used recently, or a balance of both.",
				control: {
					type: "dropdown",
					key: "ranking",
					options: { balanced: "Balanced", frequency: "Most used", recency: "Most recent" },
				},
			},
			{
				name: "When a text has several links",
				desc: "Show one row per link, or only the one used most recently or in the most notes.",
				control: {
					type: "dropdown",
					key: "multiUrl",
					options: { all: "Show all", recent: "Only most recent", used: "Only most used" },
				},
			},
			{
				name: "Accept with tab",
				desc: "Tab inserts the selected suggestion. Enter always does.",
				control: { type: "toggle", key: "tabAccepts" },
			},
			{
				name: "Show note count",
				desc: "Show how many notes use each link.",
				control: { type: "toggle", key: "showNoteCount" },
			},
			{
				name: "Open link browser in",
				desc: "Where the link browser opens: the right sidebar, or a new tab next to your notes.",
				control: {
					type: "dropdown",
					key: "browserPlacement",
					options: { sidebar: "Right sidebar", tab: "New tab" },
				},
			},
			{
				name: "Ignored link texts",
				desc: "Links with these texts are never suggested. One per line, case-insensitive.",
				control: { type: "textarea", key: "ignoredTexts", rows: 4 },
			},
			{
				name: "Ignored domains",
				desc: "Links to these domains are never suggested. One per line; * matches anything, as in *.example.com.",
				control: { type: "textarea", key: "ignoredDomains", placeholder: "*.internal.example.com", rows: 3 },
			},
			{
				name: "Rebuild index",
				desc: "Scan the whole vault again. Only needed if suggestions look out of date.",
				action: () => {
					void this.plugin.rebuildIndex();
				},
			},
			{
				type: "list",
				heading: "Excluded folders",
				emptyState: "Links in excluded folders are never suggested.",
				items: folders.map((_, index) => ({
					name: "Folder",
					control: { type: "folder", key: `${FOLDER_KEY}${index}` },
				})),
				onDelete: (index) => {
					folders.splice(index, 1);
					void this.plugin.saveSettings("index");
					this.update();
				},
				addItem: {
					name: "Add folder",
					action: () => {
						folders.push("");
						this.update();
					},
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		if (key.startsWith(FOLDER_KEY)) return settings.excludedFolders[Number(key.slice(FOLDER_KEY.length))] ?? "";
		if (isLineList(key)) return settings[key].join("\n");
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		if (key.startsWith(FOLDER_KEY)) {
			const folder = typeof value === "string" && value.trim() ? normalizePath(value) : "";
			settings.excludedFolders[Number(key.slice(FOLDER_KEY.length))] = folder === "/" ? "" : folder;
			await this.plugin.saveSettings("index");
		} else if (isLineList(key)) {
			settings[key] = lines(typeof value === "string" ? value : "");
			await this.plugin.saveSettings("index");
		} else {
			await super.setControlValue(key, value);
			this.plugin.applySettings();
		}
	}
}
