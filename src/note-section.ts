import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, MarkdownView, Menu, setIcon } from "obsidian";
import type ExternalLinkAutocompletePlugin from "./main.ts";
import type { NoteLink } from "./note-links.ts";
import type { Occurrence } from "./scanner.ts";
import { stripMarkdown } from "./text.ts";
import { renderUrl } from "./view.ts";

/** Quiet period after typing or an index update before the section is worked out again. */
const REFRESH_MS = 300;

/** What the section shows for one note. */
export interface NoteLinksData {
	links: NoteLink[];
	/** Notes in the vault using each link's URL, per the index. */
	notes: number[];
	collapsed: boolean;
	/** Equal for equal data, so unchanged sections aren't rebuilt. */
	signature: string;
}

/**
 * The note's external links, at its end. With core's backlinks in document
 * showing, it's one more pane in that block, after "Unlinked mentions", built
 * like core's own panes. Otherwise it stands alone: a block widget after the
 * last line in editing modes, or the start of the footer in reading view.
 */
function renderSection(
	el: HTMLElement,
	data: NoteLinksData,
	plugin: ExternalLinkAutocompletePlugin,
	jump: (occurrence: Occurrence) => void,
): void {
	el.empty();
	el.addClass("backlink-pane", "external-links-pane");
	const header = el.createDiv({ cls: "tree-item-self is-clickable" });
	const icon = header.createSpan({ cls: "tree-item-icon collapse-icon" });
	setIcon(icon, "right-triangle");
	icon.toggleClass("is-collapsed", data.collapsed);
	header.createDiv({ cls: "tree-item-inner", text: "External links" });
	header.createDiv({ cls: "tree-item-flair-outer" }).createSpan({ cls: "tree-item-flair", text: String(data.links.length) });
	header.addEventListener("click", () => void plugin.setNoteLinksCollapsed(!data.collapsed));
	if (data.collapsed) return;

	const list = el.createDiv({ cls: "search-result-container" });
	data.links.forEach((link, i) => {
		const row = list.createDiv({ cls: "tree-item-self is-clickable external-links-pane-item" });
		const inner = row.createDiv({ cls: "tree-item-inner" });
		inner.createSpan({ text: link.texts.map(stripMarkdown).join(", ") });
		if (link.count > 1) inner.createSpan({ cls: "external-links-pane-count", text: `×${link.count}` });
		const anchor = inner.createEl("a", {
			cls: "external-links-pane-url",
			href: link.url,
			attr: { target: "_blank", rel: "noopener", title: link.url },
		});
		renderUrl(anchor, link.url);
		anchor.addEventListener("click", (event) => event.stopPropagation());
		const notes = data.notes[i];
		if (notes > 0) {
			row.createDiv({ cls: "tree-item-flair-outer" }).createSpan({
				cls: "tree-item-flair",
				text: String(notes),
				attr: { "aria-label": notes === 1 ? "Used in 1 note" : `Used in ${notes} notes` },
			});
		}
		row.addEventListener("click", () => jump(link.first));
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			const menu = new Menu();
			plugin.addEditLinkItem(menu, link.first.text, link.url);
			menu.showAtMouseEvent(event);
		});
	});
}

const setNoteLinks = StateEffect.define<NoteLinksData | null>();

class NoteLinksWidget extends WidgetType {
	constructor(
		readonly data: NoteLinksData,
		private readonly plugin: ExternalLinkAutocompletePlugin,
	) {
		super();
	}

	eq(other: NoteLinksWidget): boolean {
		return other.data.signature === this.data.signature;
	}

	toDOM(view: EditorView): HTMLElement {
		const el = createDiv({ cls: "mod-standalone" });
		renderSection(el, this.data, this.plugin, (occurrence) => {
			const { doc } = view.state;
			if (occurrence.line >= doc.lines) return;
			const line = doc.line(occurrence.line + 1);
			const anchor = Math.min(line.from + occurrence.start, line.to);
			const head = Math.min(line.from + occurrence.end, line.to);
			view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
			view.focus();
		});
		return el;
	}

	/** The section handles its own clicks; the editor shouldn't move the cursor. */
	ignoreEvent(): boolean {
		return true;
	}
}

/** The section in editing modes, as a block widget after the last line. */
export function noteLinksExtension(plugin: ExternalLinkAutocompletePlugin): Extension {
	const field = StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update(decorations, tr) {
			for (const effect of tr.effects) {
				if (!effect.is(setNoteLinks)) continue;
				if (!effect.value) return Decoration.none;
				const widget = Decoration.widget({ widget: new NoteLinksWidget(effect.value, plugin), block: true, side: 1 });
				return Decoration.set([widget.range(tr.state.doc.length)]);
			}
			return decorations.map(tr.changes);
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	class Refresher implements PluginValue {
		private timer: number | null = null;
		private signature: string | null = null;
		private readonly unsubscribe: () => void;

		constructor(private readonly view: EditorView) {
			this.unsubscribe = plugin.onNoteLinksChange(() => this.schedule(REFRESH_MS));
			this.schedule(0);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged) this.schedule(REFRESH_MS);
		}

		private schedule(delay: number): void {
			if (this.timer !== null) window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => {
				this.timer = null;
				this.refresh();
			}, delay);
		}

		private refresh(): void {
			// Only a note's main editor: not canvas cards or other embedded editors.
			const info = this.view.state.field(editorInfoField, false);
			const file = info instanceof MarkdownView && placementOf(info)?.kind === "widget" ? info.file : null;
			const data = file ? plugin.noteLinksData(file, this.view.state.doc.toString()) : null;
			const signature = data?.signature ?? null;
			if (signature === this.signature) return;
			this.signature = signature;
			this.view.dispatch({ effects: setNoteLinks.of(data) });
		}

		destroy(): void {
			if (this.timer !== null) window.clearTimeout(this.timer);
			this.unsubscribe();
		}
	}

	return [field, ViewPlugin.fromClass(Refresher)];
}

/** Where a note's section goes; the editor widget and the panes both follow it. */
type Placement = { kind: "backlinks" | "footer"; host: HTMLElement } | { kind: "widget" } | null;

/**
 * In core's backlinks in document when they show; otherwise the editor
 * widget in editing modes, or the start of the footer in reading view. Every
 * lookup of undocumented DOM is here, and only the note's own containers
 * count: embedded notes render their own.
 */
function placementOf(view: MarkdownView): Placement {
	if (view.getMode() === "preview") {
		const footer = view.previewMode.containerEl.querySelector<HTMLElement>(
			":scope > .markdown-preview-view > .markdown-preview-sizer > .mod-footer",
		);
		if (!footer) return null;
		const backlinks = shownBacklinks(footer);
		return backlinks ? { kind: "backlinks", host: backlinks } : { kind: "footer", host: footer };
	}
	const backlinks = shownBacklinks(view.contentEl.querySelector(":scope > .markdown-source-view .cm-sizer"));
	return backlinks ? { kind: "backlinks", host: backlinks } : { kind: "widget" };
}

/** Core's backlinks in document, if they're a showing child of `parent`, however core hides them. */
function shownBacklinks(parent: Element | null): HTMLElement | null {
	const el = parent?.querySelector<HTMLElement>(":scope > .embedded-backlinks");
	return el && getComputedStyle(el).display !== "none" ? el : null;
}

/** The section everywhere but the editor widget: see `placementOf`. */
export class NoteLinksPanes {
	private readonly sections = new WeakMap<MarkdownView, { el: HTMLElement; signature: string }>();

	constructor(private readonly plugin: ExternalLinkAutocompletePlugin) {}

	refreshAll(): void {
		for (const view of this.views()) this.refresh(view);
	}

	detachAll(): void {
		for (const view of this.views()) this.sections.get(view)?.el.remove();
	}

	private views(): MarkdownView[] {
		const views: MarkdownView[] = [];
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) views.push(leaf.view);
		}
		return views;
	}

	private refresh(view: MarkdownView): void {
		const section = this.sections.get(view);
		const placement = placementOf(view);
		const target = placement && placement.kind !== "widget" ? placement : null;
		const data = target && view.file ? this.plugin.noteLinksData(view.file, view.getViewData()) : null;
		if (!target || !data) {
			section?.el.remove();
			return;
		}
		const el = section?.el ?? createDiv();
		if (el.parentElement !== target.host) {
			if (target.kind === "backlinks") target.host.appendChild(el);
			else target.host.prepend(el);
		}
		el.toggleClass("mod-standalone", target.kind === "footer");
		if (section?.signature === data.signature) return;
		renderSection(el, data, this.plugin, (occurrence) => {
			if (view.getMode() === "preview") {
				view.setEphemeralState({ line: occurrence.line });
				return;
			}
			const from = { line: occurrence.line, ch: occurrence.start };
			const to = { line: occurrence.line, ch: occurrence.end };
			view.editor.setSelection(from, to);
			view.editor.scrollIntoView({ from, to }, true);
			view.editor.focus();
		});
		this.sections.set(view, { el, signature: data.signature });
	}
}
