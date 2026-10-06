import { CachedMetadata, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { LinkIndex, pairFilter, type LinkPair } from "./index.ts";
import { rank, type Suggestion } from "./ranking.ts";
import { fallbackSkipRanges, scan, type LineRange } from "./scanner.ts";
import {
	DEFAULT_SETTINGS,
	ExternalLinkSettingTab,
	type ExternalLinkSettings,
	type SettingsImpact,
} from "./settings.ts";
import { ExternalLinkSuggest } from "./suggest.ts";

/** Quiet period before a changed note is re-scanned. */
const CHANGE_DEBOUNCE_MS = 300;
/** Quiet period before an index-affecting settings edit triggers a rebuild. */
const SETTINGS_DEBOUNCE_MS = 1000;
/** The full scan yields to the UI after this much work. */
const SCAN_SLICE_MS = 30;

export default class ExternalLinkAutocompletePlugin extends Plugin {
	settings: ExternalLinkSettings = { ...DEFAULT_SETTINGS };
	private readonly index = new LinkIndex();
	private keep: (pair: LinkPair) => boolean = () => true;
	private suggester: ExternalLinkSuggest | null = null;
	/** Bumped to abandon a full scan in progress. */
	private scanGeneration = 0;
	private readonly changeTimers = new Map<string, number>();
	private rebuildTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.suggester = new ExternalLinkSuggest(this);
		this.registerEditorSuggest(this.suggester);
		this.addSettingTab(new ExternalLinkSettingTab(this.app, this));
		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild link index",
			callback: () => {
				void this.rebuildIndex();
			},
		});

		this.register(() => {
			this.scanGeneration++;
			for (const timer of this.changeTimers.values()) window.clearTimeout(timer);
			this.changeTimers.clear();
			if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		});

		// Wait for the layout so the startup scan doesn't compete with Obsidian
		// loading, and so `vault` events for pre-existing files are skipped.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.metadataCache.on("changed", (file, data, cache) => this.onChanged(file, data, cache)),
			);
			this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
			this.registerEvent(this.app.vault.on("delete", (file) => this.onDelete(file)));
			void this.rebuildIndex();
		});
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<ExternalLinkSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Copy the lists so editing them never mutates the defaults.
		this.settings.excludedFolders = [...this.settings.excludedFolders];
		this.settings.ignoredTexts = [...this.settings.ignoredTexts];
		this.settings.ignoredDomains = [...this.settings.ignoredDomains];
		this.keep = pairFilter(this.settings);
	}

	async saveSettings(impact: SettingsImpact): Promise<void> {
		await this.saveData(this.settings);
		if (impact === "suggester") {
			this.applySettings();
			return;
		}
		this.keep = pairFilter(this.settings);
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			void this.rebuildIndex();
		}, SETTINGS_DEBOUNCE_MS);
	}

	/** Pushes settings that only affect the popup into the suggester. */
	applySettings(): void {
		this.suggester?.applySettings();
	}

	/** Ranked rows for a query; synchronous, straight from memory. */
	suggest(query: string, limit: number): Suggestion[] {
		return rank(query, this.index.entries(), {
			mode: this.settings.ranking,
			multiUrl: this.settings.multiUrl,
			limit,
			now: Date.now(),
		});
	}

	/** Whether a line of a note is frontmatter or code, per the metadata cache. */
	isInSkippedSection(file: TFile, line: number): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;
		return skipRanges(cache).some(([start, end]) => line >= start && line <= end);
	}

	/**
	 * Scans the whole vault into a fresh index. Yields to the UI between
	 * slices; until it finishes, suggestions come from what's indexed so far.
	 */
	async rebuildIndex(): Promise<void> {
		const generation = ++this.scanGeneration;
		this.index.clear();
		let sliceStart = performance.now();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (generation !== this.scanGeneration) return;
			if (this.isExcluded(file.path)) continue;
			try {
				const data = await this.app.vault.cachedRead(file);
				if (generation !== this.scanGeneration) return;
				this.indexContent(file, data, this.app.metadataCache.getFileCache(file));
			} catch (error) {
				console.error(`External Link Autocomplete: could not index ${file.path}`, error);
			}
			if (performance.now() - sliceStart > SCAN_SLICE_MS) {
				await sleep(0);
				sliceStart = performance.now();
			}
		}
	}

	private indexContent(file: TFile, data: string, cache: CachedMetadata | null): void {
		const skip = cache?.sections ? skipRanges(cache) : fallbackSkipRanges(data);
		const pairs = scan(data, skip).filter(this.keep);
		this.index.setFile(file.path, file.stat.mtime, pairs);
	}

	private isExcluded(path: string): boolean {
		return this.settings.excludedFolders.some(
			(folder) => folder.length > 0 && (path === folder || path.startsWith(`${folder}/`)),
		);
	}

	private onChanged(file: TFile, data: string, cache: CachedMetadata): void {
		// `file.path` is read again when the timer fires: a rename in between
		// updates the TFile, so the content lands under the new path.
		const key = file.path;
		this.cancelPendingChange(key);
		const timer = window.setTimeout(() => {
			this.changeTimers.delete(key);
			if (this.isExcluded(file.path)) this.index.removeFile(file.path);
			else this.indexContent(file, data, cache);
		}, CHANGE_DEBOUNCE_MS);
		this.changeTimers.set(key, timer);
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFolder) {
			// Children are re-keyed one by one; cover them here too in case the
			// vault only reports the folder.
			for (const child of this.app.vault.getMarkdownFiles()) {
				if (child.path.startsWith(`${file.path}/`)) {
					this.moveFile(child, `${oldPath}${child.path.slice(file.path.length)}`);
				}
			}
		} else if (file instanceof TFile && file.extension === "md") {
			this.moveFile(file, oldPath);
		}
	}

	private moveFile(file: TFile, oldPath: string): void {
		if (this.isExcluded(file.path)) {
			this.index.removeFile(oldPath);
		} else if (this.index.has(oldPath)) {
			this.index.renameFile(oldPath, file.path);
		} else if (this.isExcluded(oldPath)) {
			// Moved out of an excluded folder: index it for the first time.
			void this.app.vault.cachedRead(file).then(
				(data) => this.indexContent(file, data, this.app.metadataCache.getFileCache(file)),
				(error: unknown) => console.error(`External Link Autocomplete: could not index ${file.path}`, error),
			);
		}
	}

	private onDelete(file: TAbstractFile): void {
		const prefix = `${file.path}/`;
		for (const path of this.index.paths()) {
			if (path === file.path || path.startsWith(prefix)) {
				this.cancelPendingChange(path);
				this.index.removeFile(path);
			}
		}
		this.cancelPendingChange(file.path);
	}

	private cancelPendingChange(path: string): void {
		const timer = this.changeTimers.get(path);
		if (timer === undefined) return;
		window.clearTimeout(timer);
		this.changeTimers.delete(path);
	}
}

/** Code blocks and frontmatter, as inclusive line ranges. */
function skipRanges(cache: CachedMetadata): LineRange[] {
	const ranges: LineRange[] = [];
	if (cache.frontmatterPosition) {
		ranges.push([cache.frontmatterPosition.start.line, cache.frontmatterPosition.end.line]);
	}
	for (const section of cache.sections ?? []) {
		if (section.type === "code") ranges.push([section.position.start.line, section.position.end.line]);
	}
	return ranges;
}
