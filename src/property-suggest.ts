import { AbstractInputSuggest, Platform } from "obsidian";
import type ExternalLinkAutocompletePlugin from "./main.ts";
import type { Suggestion } from "./ranking.ts";
import { renderLinkRow } from "./suggest.ts";
import { fold, formatDestination } from "./text.ts";
import { findTrigger, type TriggerMatch } from "./trigger.ts";

/**
 * The Properties view's value inputs for text and list properties, both
 * contenteditable divs. Undocumented DOM, read from Obsidian 1.15.1.
 */
export const PROPERTY_INPUTS =
	".metadata-property-value .metadata-input-longtext, .metadata-property-value .multi-select-input";

/**
 * The popup for a property value in the Properties view, where the editor
 * suggester can't reach. Same trigger and rows, applied to the input's text
 * at the caret. Accepting only writes into the input: Obsidian commits the
 * value on Enter or blur, as when typing, and quotes it in the YAML.
 *
 * Obsidian's keymap handles keys in the capture phase and stops them, so
 * while the popup is open its Enter, Tab and Esc never reach the input's own
 * handlers, which would commit or revert the value.
 */
export class PropertyLinkSuggest extends AbstractInputSuggest<Suggestion> {
	/** The `[…` being typed, set while there are rows for it. */
	private match: TriggerMatch | null = null;
	/** Column of the `[` dismissed with Esc; stays closed until the caret leaves it. */
	private dismissed: number | null = null;
	private accepting = false;
	private rendered: { el: HTMLElement; value: Suggestion }[] = [];

	constructor(
		private readonly plugin: ExternalLinkAutocompletePlugin,
		readonly inputEl: HTMLDivElement,
	) {
		super(plugin.app, inputEl);
		this.limit = Platform.isMobile ? 5 : 8;
		this.scope.register([], "Tab", (event) => this.onTab(event));
	}

	protected getSuggestions(_query: string): Suggestion[] {
		this.rendered = [];
		this.match = null;
		try {
			if (!this.plugin.propertySuggestions) return [];
			const match = this.findMatch();
			if (!match) {
				this.dismissed = null;
				return [];
			}
			if (this.dismissed === match.start) return [];
			this.dismissed = null;
			if (fold(match.query).length < this.plugin.settings.minChars) return [];
			const rows = this.plugin.suggest(match.query, this.limit);
			if (rows.length > 0) this.match = match;
			return rows;
		} catch (error) {
			console.error("External Link Autocomplete: property suggestions failed", error);
			return [];
		}
	}

	renderSuggestion(value: Suggestion, el: HTMLElement): void {
		this.rendered.push({ el, value });
		renderLinkRow(el, value, this.plugin.settings.showNoteCount);
	}

	selectSuggestion(value: Suggestion, _event: MouseEvent | KeyboardEvent): void {
		const match = this.match;
		if (!match) return;
		const text = this.inputEl.textContent ?? "";
		const link = `[${value.text}](${formatDestination(value.url)})`;
		this.accepting = true;
		this.close();
		this.accepting = false;
		this.inputEl.textContent = text.slice(0, match.start) + link + text.slice(match.end);
		setCaret(this.inputEl, match.start + link.length);
		this.inputEl.trigger("input");
	}

	/** Every close that isn't an accept counts as a dismissal, as in the editor. */
	close(): void {
		if (this.match && !this.accepting) this.dismissed = this.match.start;
		this.match = null;
		super.close();
	}

	/** The trigger at the caret, on the caret's line of the input, in columns of the whole text. */
	private findMatch(): TriggerMatch | null {
		const caret = caretOffset(this.inputEl);
		if (caret === null) return null;
		const text = this.inputEl.textContent ?? "";
		const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
		const newline = text.indexOf("\n", caret);
		const line = text.slice(lineStart, newline < 0 ? text.length : newline);
		const match = findTrigger(line, caret - lineStart);
		if (!match) return null;
		return { start: lineStart + match.start, end: lineStart + match.end, query: match.query };
	}

	private onTab(event: KeyboardEvent): boolean | undefined {
		if (event.isComposing || !this.plugin.settings.tabAccepts) return undefined;
		const row = this.rendered.find((entry) => entry.el.hasClass("is-selected")) ?? this.rendered[0];
		if (!row) return undefined;
		this.selectSuggestion(row.value, event);
		return false;
	}
}

/** The caret's offset in the element's text, or null without a collapsed selection inside it. */
function caretOffset(el: HTMLElement): number | null {
	const selection = el.win.getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!range.collapsed || !el.contains(range.endContainer)) return null;
	const before = el.doc.createRange();
	before.selectNodeContents(el);
	before.setEnd(range.endContainer, range.endOffset);
	return before.toString().length;
}

/** Puts the caret at `offset` in an element holding a single text node. */
function setCaret(el: HTMLElement, offset: number): void {
	const selection = el.win.getSelection();
	const node = el.firstChild;
	if (!selection || !node) return;
	const range = el.doc.createRange();
	range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}
