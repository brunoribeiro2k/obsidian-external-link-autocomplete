import { debounce, ItemView, Keymap, MarkdownView, Menu, SearchComponent, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { excerpt, isVariantOf, type CatalogGroup, type CatalogSort, type CatalogVariant, type Grouping } from "./catalog.ts";
import type ExternalLinkAutocompletePlugin from "./main.ts";
import type { Occurrence } from "./scanner.ts";
import { describeUrl, stripMarkdown } from "./text.ts";

export const LINK_BROWSER_VIEW = "external-link-browser";

/** Groups rendered at first, and added by each "Show more". */
const PAGE_SIZE = 200;
/** Index updates arrive per note; re-render at most this often. */
const REFRESH_MS = 500;

const GROUPINGS: [Grouping, string][] = [
	["url", "Group by URL"],
	["text", "Group by text"],
];
const SORTS: [CatalogSort, string][] = [
	["notes", "Most notes"],
	["name", "Name (A to Z)"],
	["recent", "Recently used"],
];

interface TreeItemOptions {
	label: (el: HTMLElement) => void;
	tooltip?: string;
	flair?: string;
	openByDefault: boolean;
	children: (el: HTMLElement) => void;
	/** Fills the row's right-click (long-press on mobile) menu. */
	menu?: (menu: Menu) => void;
}

/**
 * Every external link in the index, grouped by URL or by text, with the
 * notes that use it. Lives in the right sidebar or in a main tab.
 */
export class LinkBrowserView extends ItemView {
	/** Ids of tree items whose open state differs from their default. */
	private readonly toggled = new Set<string>();
	private readonly listEl: HTMLElement;
	private inconsistentButton: HTMLElement | null = null;
	private filter = "";
	private shown = PAGE_SIZE;
	private readonly refresh = debounce(() => this.render(), REFRESH_MS, false);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ExternalLinkAutocompletePlugin,
	) {
		super(leaf);
		this.listEl = createDiv({ cls: "external-link-browser-list" });
	}

	getViewType(): string {
		return LINK_BROWSER_VIEW;
	}

	getDisplayText(): string {
		return "External links";
	}

	getIcon(): string {
		return "external-link";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("external-link-browser");
		const header = this.contentEl.createDiv({ cls: "nav-header" });
		const buttons = header.createDiv({ cls: "nav-buttons-container" });

		const sortButton = buttons.createDiv({
			cls: "clickable-icon nav-action-button",
			attr: { "aria-label": "Change grouping and sort order" },
		});
		setIcon(sortButton, "arrow-up-narrow-wide");
		sortButton.addEventListener("click", (event) => this.showSortMenu(event));

		this.inconsistentButton = buttons.createDiv({
			cls: "clickable-icon nav-action-button",
			attr: { "aria-label": "Show only inconsistent links" },
		});
		setIcon(this.inconsistentButton, "split");
		this.inconsistentButton.addEventListener("click", () => {
			void this.savePrefs({ browserOnlyInconsistent: !this.plugin.settings.browserOnlyInconsistent });
		});

		const search = new SearchComponent(header.createDiv({ cls: "external-link-browser-search" }));
		search.setPlaceholder("Filter by text or URL");
		search.onChange((value) => {
			this.filter = value;
			this.shown = PAGE_SIZE;
			this.render();
		});

		this.contentEl.appendChild(this.listEl);
		this.register(this.plugin.onIndexChange(() => this.refresh()));
		this.render();
	}

	async onClose(): Promise<void> {
		this.refresh.cancel();
	}

	private showSortMenu(event: MouseEvent): void {
		const settings = this.plugin.settings;
		const menu = new Menu();
		for (const [grouping, title] of GROUPINGS) {
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setChecked(settings.browserGrouping === grouping)
					.onClick(() => void this.savePrefs({ browserGrouping: grouping })),
			);
		}
		menu.addSeparator();
		for (const [sort, title] of SORTS) {
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setChecked(settings.browserSort === sort)
					.onClick(() => void this.savePrefs({ browserSort: sort })),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private async savePrefs(
		prefs: Partial<Pick<typeof this.plugin.settings, "browserGrouping" | "browserSort" | "browserOnlyInconsistent">>,
	): Promise<void> {
		Object.assign(this.plugin.settings, prefs);
		this.shown = PAGE_SIZE;
		this.render();
		await this.plugin.saveSettings("browser");
	}

	private render(): void {
		const settings = this.plugin.settings;
		this.inconsistentButton?.toggleClass("is-active", settings.browserOnlyInconsistent);
		const scroll = this.contentEl.scrollTop;
		this.listEl.empty();

		const groups = this.plugin.catalog({
			grouping: settings.browserGrouping,
			sort: settings.browserSort,
			filter: this.filter,
			onlyInconsistent: settings.browserOnlyInconsistent,
		});
		if (groups.length === 0) {
			const filtered = this.filter.length > 0 || settings.browserOnlyInconsistent;
			this.listEl.createDiv({ cls: "pane-empty", text: filtered ? "No links match." : "No external links yet." });
			return;
		}
		for (const group of groups.slice(0, this.shown)) this.renderGroup(group, settings.browserGrouping);
		if (groups.length > this.shown) {
			const more = this.listEl.createEl("button", {
				cls: "external-link-browser-more",
				text: `Show more (${groups.length - this.shown})`,
			});
			more.addEventListener("click", () => {
				this.shown += PAGE_SIZE;
				this.render();
			});
		}
		this.contentEl.scrollTop = scroll;
	}

	private renderGroup(group: CatalogGroup, grouping: Grouping): void {
		const byUrl = grouping === "url";
		this.treeItem(this.listEl, group.id, {
			label: (el) => (byUrl ? renderUrl(el, group.label) : el.setText(stripMarkdown(group.label))),
			tooltip: byUrl ? group.label : undefined,
			flair: String(group.notes),
			openByDefault: false,
			children: (el) => {
				for (const variant of group.variants) this.renderVariant(el, `${group.id}\0${variant.id}`, variant, byUrl);
			},
			menu: (menu) => this.addEditItem(menu, group.variants[0]),
		});
	}

	private renderVariant(parent: HTMLElement, id: string, variant: CatalogVariant, byUrl: boolean): void {
		this.treeItem(parent, id, {
			label: (el) => (byUrl ? el.setText(stripMarkdown(variant.text)) : renderUrl(el, variant.url)),
			tooltip: byUrl ? undefined : variant.url,
			flair: String(variant.paths.length),
			openByDefault: false,
			children: (el) => {
				for (const path of variant.paths) this.renderNote(el, `${id}\0${path}`, variant, path);
			},
			menu: (menu) => this.addEditItem(menu, variant),
		});
	}

	private renderNote(parent: HTMLElement, id: string, variant: CatalogVariant, path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		this.treeItem(parent, id, {
			label: (el) => el.setText(file.basename),
			tooltip: path,
			openByDefault: true,
			children: (el) => void this.renderMatches(el.createDiv({ cls: "search-result-file-matches" }), file, variant),
		});
	}

	/** The lines of a note holding the variant, each opening the note there. */
	private async renderMatches(el: HTMLElement, file: TFile, variant: CatalogVariant): Promise<void> {
		let scanned: { lines: string[]; occurrences: Occurrence[] };
		try {
			scanned = await this.plugin.scanFile(file);
		} catch (error) {
			console.error(`External Link Autocomplete: could not read ${file.path}`, error);
			return;
		}
		for (const occurrence of scanned.occurrences) {
			if (!isVariantOf(occurrence, variant)) continue;
			const { before, match, after } = excerpt(scanned.lines[occurrence.line], occurrence.start, occurrence.end);
			const row = el.createDiv({ cls: "search-result-file-match" });
			row.appendText(before);
			row.createSpan({ cls: "search-result-file-matched-text", text: match });
			row.appendText(after);
			row.addEventListener("click", (event) => void this.openAt(file, occurrence, event));
		}
	}

	private async openAt(file: TFile, occurrence: Occurrence, event: MouseEvent): Promise<void> {
		const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(event));
		await leaf.openFile(file, { active: true, eState: { line: occurrence.line } });
		if (!(leaf.view instanceof MarkdownView)) return;
		const from = { line: occurrence.line, ch: occurrence.start };
		const to = { line: occurrence.line, ch: occurrence.end };
		leaf.view.editor.setSelection(from, to);
		leaf.view.editor.scrollIntoView({ from, to }, true);
	}

	private addEditItem(menu: Menu, variant: CatalogVariant): void {
		menu.addItem((item) =>
			item
				.setTitle("Edit link across vault")
				.setIcon("pencil")
				.onClick(() => this.plugin.openEditLink(variant.text, variant.url)),
		);
	}

	/** A collapsible row with core's tree classes; children render on expand. */
	private treeItem(parent: HTMLElement, id: string, options: TreeItemOptions): void {
		const item = parent.createDiv({ cls: "tree-item" });
		const self = item.createDiv({ cls: "tree-item-self is-clickable mod-collapsible" });
		const icon = self.createDiv({ cls: "tree-item-icon collapse-icon" });
		setIcon(icon, "right-triangle");
		options.label(self.createDiv({ cls: "tree-item-inner" }));
		if (options.tooltip) self.setAttr("title", options.tooltip);
		if (options.flair) {
			self.createDiv({ cls: "tree-item-flair-outer" }).createSpan({ cls: "tree-item-flair", text: options.flair });
		}
		const children = item.createDiv({ cls: "tree-item-children" });

		const apply = (): void => {
			const open = this.toggled.has(id) !== options.openByDefault;
			item.toggleClass("is-collapsed", !open);
			icon.toggleClass("is-collapsed", !open);
			children.empty();
			if (open) options.children(children);
		};
		self.addEventListener("click", () => {
			if (!this.toggled.delete(id)) this.toggled.add(id);
			apply();
		});
		const fillMenu = options.menu;
		if (fillMenu) {
			self.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				const menu = new Menu();
				fillMenu(menu);
				menu.showAtMouseEvent(event);
			});
		}
		apply();
	}
}

/** `host › path`, as in the suggestion popup. */
function renderUrl(el: HTMLElement, url: string): void {
	const { host, path } = describeUrl(url, 60);
	el.createSpan({ text: host });
	if (path) {
		el.createSpan({ cls: "external-link-autocomplete-separator", text: "›" });
		el.createSpan({ text: path });
	}
}
