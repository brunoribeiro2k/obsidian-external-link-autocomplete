import { CachedMetadata, Editor, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { buildCatalog, type CatalogGroup, type CatalogOptions } from "./catalog.ts";
import { EditLinkModal } from "./edit-modal.ts";
import { LinkIndex, pairFilter, type LinkPair } from "./index.ts";
import { rank, type Suggestion } from "./ranking.ts";
import {
	appliedLinks,
	applyChanges,
	linkAt,
	planRevert,
	planRewrite,
	type AppliedLink,
	type LinkChange,
	type RewriteSpec,
} from "./rewrite.ts";
import { fallbackSkipRanges, scan, type LineRange, type Occurrence } from "./scanner.ts";
import {
	DEFAULT_SETTINGS,
	ExternalLinkSettingTab,
	type ExternalLinkSettings,
	type SettingsImpact,
} from "./settings.ts";
import { ExternalLinkSuggest } from "./suggest.ts";
import { fold, mostFrequent, normUrl, stripMarkdown } from "./text.ts";
import { LINK_BROWSER_VIEW, LinkBrowserView } from "./view.ts";

/** Quiet period before a changed note is re-scanned. */
const CHANGE_DEBOUNCE_MS = 300;
/** Quiet period before an index-affecting settings edit triggers a rebuild. */
const SETTINGS_DEBOUNCE_MS = 1000;
/** The full scan yields to the UI after this much work. */
const SCAN_SLICE_MS = 30;

/** What a vault-wide link edit would change in one note. */
export interface RewritePreview {
	file: TFile;
	lines: string[];
	changes: LinkChange[];
}

export default class ExternalLinkAutocompletePlugin extends Plugin {
	settings: ExternalLinkSettings = { ...DEFAULT_SETTINGS };
	private readonly index = new LinkIndex(() => {
		for (const listener of this.indexListeners) listener();
	});
	private readonly indexListeners = new Set<() => void>();
	private keep: (pair: LinkPair) => boolean = () => true;
	private suggester: ExternalLinkSuggest | null = null;
	/** Bumped to abandon a full scan in progress. */
	private scanGeneration = 0;
	private readonly changeTimers = new Map<string, number>();
	private rebuildTimer: number | null = null;
	/** The last vault-wide link edit, per note, kept for this session only. */
	private lastEdit: Map<string, AppliedLink[]> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.suggester = new ExternalLinkSuggest(this);
		this.registerEditorSuggest(this.suggester);
		this.addSettingTab(new ExternalLinkSettingTab(this.app, this));
		this.registerView(LINK_BROWSER_VIEW, (leaf) => new LinkBrowserView(leaf, this));
		this.addCommand({
			id: "open-link-browser",
			name: "Open link browser",
			callback: () => {
				void this.openLinkBrowser(false);
			},
		});
		this.addCommand({
			id: "open-link-browser-in-new-tab",
			name: "Open link browser in new tab",
			callback: () => {
				void this.openLinkBrowser(true);
			},
		});
		this.addCommand({
			id: "edit-link-across-vault",
			name: "Edit link across vault",
			editorCheckCallback: (checking, editor, info) => {
				const link = this.linkAtCursor(editor, info.file);
				if (!link) return false;
				if (!checking) this.openEditLink(link.text, link.url);
				return true;
			},
		});
		this.addCommand({
			id: "undo-last-link-edit",
			name: "Undo last link edit",
			checkCallback: (checking) => {
				if (!this.lastEdit) return false;
				if (!checking) void this.undoLastEdit();
				return true;
			},
		});
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const link = this.linkAtCursor(editor, info.file);
				if (link) this.addEditLinkItem(menu, link.text, link.url);
			}),
		);
		// Right-clicking a rendered link (Live Preview, reading view) only
		// reports the URL: take the text from the cursor when it's on that
		// link, or the URL's most used text otherwise.
		this.registerEvent(
			this.app.workspace.on("url-menu", (menu, url) => {
				const urlKey = normUrl(url);
				const variants = this.variantsOfUrl(urlKey);
				if (variants.length === 0) return;
				const active = this.app.workspace.activeEditor;
				const atCursor = active?.editor ? this.linkAtCursor(active.editor, active.file) : null;
				if (atCursor && normUrl(atCursor.url) === urlKey) {
					this.addEditLinkItem(menu, atCursor.text, atCursor.url);
				} else {
					const top = variants.reduce((best, variant) => (variant.paths.length > best.paths.length ? variant : best));
					this.addEditLinkItem(menu, top.text, url);
				}
			}),
		);
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
		if (impact === "browser") return;
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

	/** The index's ignore-list filter; vault-wide edits leave what it drops alone. */
	get linkFilter(): (pair: LinkPair) => boolean {
		return this.keep;
	}

	/** The texts used for one URL, with their notes. */
	variantsOfUrl(urlKey: string): { key: string; text: string; paths: readonly string[] }[] {
		const out = [];
		for (const stat of this.index.pairStats()) {
			if (stat.urlKey === urlKey) out.push({ key: stat.key, text: mostFrequent(stat.texts), paths: [...stat.paths] });
		}
		return out;
	}

	/** Opens the edit modal on a link, unless the index leaves it out. */
	openEditLink(text: string, url: string): void {
		const key = fold(stripMarkdown(text));
		const urlKey = normUrl(url);
		if (!this.variantsOfUrl(urlKey).some((variant) => variant.key === key)) {
			new Notice("This link is in an excluded folder or on an ignore list, so it can't be edited across the vault.");
			return;
		}
		new EditLinkModal(this, { key, urlKey, text, url }).open();
	}

	/** Each note the spec would change, with its changes; nothing is written. */
	async previewRewrite(spec: RewriteSpec): Promise<RewritePreview[]> {
		const previews: RewritePreview[] = [];
		for (const file of this.rewriteCandidates(spec)) {
			try {
				const content = this.openEditor(file.path)?.getValue() ?? (await this.app.vault.cachedRead(file));
				const changes = planRewrite(content, this.rewriteSkipRanges(file, content), spec);
				if (changes.length > 0) previews.push({ file, lines: content.split(/\r?\n/), changes });
			} catch (error) {
				console.error(`External Link Autocomplete: could not read ${file.path}`, error);
			}
		}
		return previews;
	}

	/**
	 * Applies the spec to every note it matches, planning again against each
	 * note's current content, and remembers what changed for the undo command.
	 */
	async rewriteLinks(spec: RewriteSpec): Promise<{ links: number; notes: number }> {
		const applied = new Map<string, AppliedLink[]>();
		let links = 0;
		let notes = 0;
		for (const file of this.rewriteCandidates(spec)) {
			let changed = 0;
			try {
				changed = await this.editNote(file, (content) => {
					const changes = planRewrite(content, this.rewriteSkipRanges(file, content), spec);
					if (changes.length > 0) applied.set(file.path, appliedLinks(content, changes));
					return changes;
				});
			} catch (error) {
				console.error(`External Link Autocomplete: could not edit ${file.path}`, error);
			}
			links += changed;
			if (changed > 0) notes++;
		}
		if (applied.size > 0) this.lastEdit = applied;
		return { links, notes };
	}

	/** Puts back the links the last vault-wide edit changed, where they're unchanged since. */
	async undoLastEdit(): Promise<void> {
		const edit = this.lastEdit;
		if (!edit) return;
		this.lastEdit = null;
		let links = 0;
		let notes = 0;
		let skipped = 0;
		for (const [path, applied] of edit) {
			const file = this.app.vault.getFileByPath(path);
			if (!file) {
				skipped += applied.length;
				continue;
			}
			try {
				const reverted = await this.editNote(file, (content) => {
					const plan = planRevert(content, applied);
					skipped += plan.skipped;
					return plan.changes;
				});
				links += reverted;
				if (reverted > 0) notes++;
			} catch (error) {
				console.error(`External Link Autocomplete: could not edit ${file.path}`, error);
			}
		}
		let message = `Reverted ${links === 1 ? "1 link" : `${links} links`} in ${notes === 1 ? "1 note" : `${notes} notes`}.`;
		if (skipped > 0) message += ` ${skipped === 1 ? "1 link was" : `${skipped} links were`} edited since and left as is.`;
		new Notice(message);
	}

	/**
	 * Applies the changes `plan` makes for a note's current content. Open
	 * notes are edited through their editor, so unsaved typing isn't lost and
	 * Ctrl+Z works there; the rest go through `Vault.process`. Returns how
	 * many links changed.
	 */
	private async editNote(file: TFile, plan: (content: string) => LinkChange[]): Promise<number> {
		const editor = this.openEditor(file.path);
		if (editor) {
			const changes = plan(editor.getValue());
			editor.transaction({
				changes: changes.flatMap((change) =>
					change.edits.map((edit) => ({
						from: { line: change.line, ch: edit.from },
						to: { line: change.line, ch: edit.to },
						text: edit.insert,
					})),
				),
			});
			return changes.length;
		}
		let changed = 0;
		await this.app.vault.process(file, (content) => {
			const changes = plan(content);
			changed = changes.length;
			return applyChanges(content, changes);
		});
		return changed;
	}

	/** Notes the index says use the spec's links. */
	private rewriteCandidates(spec: RewriteSpec): TFile[] {
		const paths = new Set<string>();
		for (const variant of this.variantsOfUrl(spec.urlKey)) {
			if (spec.allTexts || variant.key === spec.key) for (const path of variant.paths) paths.add(path);
		}
		const files: TFile[] = [];
		for (const path of [...paths].sort()) {
			const file = this.app.vault.getFileByPath(path);
			if (file) files.push(file);
		}
		return files;
	}

	/**
	 * Both the metadata cache's ranges and the text-derived ones: the cache
	 * can lag behind an editor by a moment, and skipping too much only leaves
	 * a link unedited, while skipping too little could edit code.
	 */
	private rewriteSkipRanges(file: TFile, content: string): LineRange[] {
		const cache = this.app.metadataCache.getFileCache(file);
		return [...(cache ? skipRanges(cache) : []), ...fallbackSkipRanges(content)];
	}

	private openEditor(path: string): Editor | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) return leaf.view.editor;
		}
		return null;
	}

	/** The external link under the cursor, outside code and frontmatter. */
	private linkAtCursor(editor: Editor, file: TFile | null): Occurrence | null {
		const cursor = editor.getCursor();
		if (file && this.isInSkippedSection(file, cursor.line)) return null;
		return linkAt(editor.getLine(cursor.line), cursor.ch);
	}

	private addEditLinkItem(menu: Menu, text: string, url: string): void {
		menu.addItem((item) =>
			item
				.setTitle("Edit link across vault")
				.setIcon("pencil")
				.setSection("action")
				.onClick(() => this.openEditLink(text, url)),
		);
	}

	/** Groups the index for the link browser. */
	catalog(options: CatalogOptions): CatalogGroup[] {
		return buildCatalog(this.index.pairStats(), (path) => this.index.mtime(path), options);
	}

	/** Runs `listener` after every index update; returns the unsubscribe. */
	onIndexChange(listener: () => void): () => void {
		this.indexListeners.add(listener);
		return () => this.indexListeners.delete(listener);
	}

	/** Every link in a note, read fresh, with its lines for context. */
	async scanFile(file: TFile): Promise<{ lines: string[]; occurrences: Occurrence[] }> {
		const data = await this.app.vault.cachedRead(file);
		return { lines: data.split(/\r?\n/), occurrences: scan(data, skipRangesFor(data, this.app.metadataCache.getFileCache(file))) };
	}

	/**
	 * Reveals the link browser if it's open (in a main tab, when `newTab`),
	 * or opens it where the settings say, or in a new tab.
	 */
	async openLinkBrowser(newTab: boolean): Promise<void> {
		const { workspace } = this.app;
		let leaf =
			workspace.getLeavesOfType(LINK_BROWSER_VIEW).find((open) => !newTab || open.getRoot() === workspace.rootSplit) ??
			null;
		if (!leaf) {
			leaf = newTab || this.settings.browserPlacement === "tab" ? workspace.getLeaf("tab") : workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: LINK_BROWSER_VIEW, active: true });
		}
		await workspace.revealLeaf(leaf);
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
		const pairs = scan(data, skipRangesFor(data, cache)).filter(this.keep);
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
		const applied = this.lastEdit?.get(oldPath);
		if (applied) {
			this.lastEdit?.delete(oldPath);
			this.lastEdit?.set(file.path, applied);
		}
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

/** Skip ranges from the metadata cache, or worked out from the text without it. */
function skipRangesFor(data: string, cache: CachedMetadata | null): LineRange[] {
	return cache?.sections ? skipRanges(cache) : fallbackSkipRanges(data);
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
