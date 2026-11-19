import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	KeymapEventHandler,
	Platform,
	renderMatches,
	TFile,
} from "obsidian";
import { encodeScalar, type LinkContext } from "./frontmatter.ts";
import type ExternalLinkAutocompletePlugin from "./main.ts";
import type { Suggestion } from "./ranking.ts";
import { describeUrl, escapePipes, fold, formatDestination } from "./text.ts";
import { findTrigger, isTableRow } from "./trigger.ts";

/**
 * The popup. It only claims the trigger when there is something to suggest:
 * Obsidian runs suggesters in order and stops at the first whose `onTrigger`
 * returns non-null, so an empty claim would starve the suggesters after it.
 */
export class ExternalLinkSuggest extends EditorSuggest<Suggestion> {
	/** Rows computed in `onTrigger`, reused by `getSuggestions`. */
	private pending: { query: string; rows: Suggestion[] } | null = null;
	/** The `[` the user dismissed with Esc; stays closed until the cursor leaves it. */
	private dismissed: string | null = null;
	private accepting = false;
	private rendered: { el: HTMLElement; value: Suggestion }[] = [];
	private tabHandler: KeymapEventHandler | null = null;

	constructor(private readonly plugin: ExternalLinkAutocompletePlugin) {
		super(plugin.app);
		this.limit = Platform.isMobile ? 5 : 8;
		this.applySettings();
	}

	/** Re-reads the settings the popup itself depends on. */
	applySettings(): void {
		const tabAccepts = this.plugin.settings.tabAccepts;
		if (!Platform.isMobile) {
			this.setInstructions([
				{ command: "↑↓", purpose: "to navigate" },
				{ command: tabAccepts ? "↵ or tab" : "↵", purpose: "to insert" },
				{ command: "esc", purpose: "to dismiss" },
			]);
		}
		if (tabAccepts && !this.tabHandler) {
			this.tabHandler = this.scope.register([], "Tab", (event) => this.onTab(event));
		} else if (!tabAccepts && this.tabHandler) {
			this.scope.unregister(this.tabHandler);
			this.tabHandler = null;
		}
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		try {
			const match = findTrigger(editor.getLine(cursor.line), cursor.ch);
			if (!match) {
				this.dismissed = null;
				return null;
			}
			const anchor = `${file?.path ?? ""}:${cursor.line}:${match.start}`;
			if (this.dismissed === anchor) return null;
			this.dismissed = null;

			if (fold(match.query).length < this.plugin.settings.minChars) return null;
			if (!this.plugin.linkContext(editor, file, cursor.line, match.start)) return null;

			const rows = this.plugin.suggest(match.query, this.limit);
			if (rows.length === 0) return null;
			this.pending = { query: match.query, rows };
			return {
				start: { line: cursor.line, ch: match.start },
				end: { line: cursor.line, ch: match.end },
				query: match.query,
			};
		} catch (error) {
			console.error("External Link Autocomplete: trigger failed", error);
			return null;
		}
	}

	getSuggestions(context: EditorSuggestContext): Suggestion[] {
		this.rendered = [];
		const pending = this.pending;
		this.pending = null;
		if (pending && pending.query === context.query) return pending.rows;
		return this.plugin.suggest(context.query, this.limit);
	}

	renderSuggestion(value: Suggestion, el: HTMLElement): void {
		this.rendered.push({ el, value });
		renderLinkRow(el, value, this.plugin.settings.showNoteCount);
	}

	selectSuggestion(value: Suggestion, _event: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		const { editor, start, end } = context;
		const where = this.plugin.linkContext(editor, context.file, start.line, start.ch) ?? "body";
		const link = formatLink(value, where, editor.getLine(start.line));

		this.accepting = true;
		this.close();
		this.accepting = false;
		editor.replaceRange(link, start, end);
		editor.setCursor({ line: start.line, ch: start.ch + link.length });
	}

	/**
	 * Every close that isn't an accept counts as a dismissal (Esc, a click
	 * elsewhere), so the popup doesn't reopen at the same `[` right away.
	 */
	close(): void {
		const context = this.context;
		if (context && !this.accepting) {
			const path = (context.file as TFile | null)?.path ?? "";
			this.dismissed = `${path}:${context.start.line}:${context.start.ch}`;
		}
		super.close();
	}

	private onTab(event: KeyboardEvent): boolean | undefined {
		if (event.isComposing) return undefined;
		const row = this.rendered.find((entry) => entry.el.hasClass("is-selected")) ?? this.rendered[0];
		if (!row) return undefined;
		this.selectSuggestion(row.value, event);
		return false;
	}
}

/** The link a suggestion inserts, written for where it goes. */
function formatLink(value: Suggestion, where: LinkContext, lineText: string): string {
	const destination = formatDestination(value.url);
	if (where === "body") {
		if (!isTableRow(lineText)) return `[${value.text}](${destination})`;
		return `[${escapePipes(value.text)}](${escapePipes(destination)})`;
	}
	if (where === "wrap") return `"${encodeScalar(`[${value.text}](${destination})`, "double")}"`;
	return `[${encodeScalar(value.text, where)}](${encodeScalar(destination, where)})`;
}

/** One suggestion row, as core's own suggesters draw them; shared with the Properties view's popup. */
export function renderLinkRow(el: HTMLElement, value: Suggestion, showNoteCount: boolean): void {
	el.addClass("mod-complex", "external-link-autocomplete-item");
	const content = el.createDiv({ cls: "suggestion-content" });
	renderMatches(content.createDiv({ cls: "suggestion-title" }), value.display, value.matches);

	const { host, path } = describeUrl(value.url);
	const note = content.createDiv({ cls: "suggestion-note external-link-autocomplete-url" });
	note.createSpan({ text: host });
	if (path && !Platform.isMobile) {
		note.createSpan({ cls: "external-link-autocomplete-separator", text: "›" });
		note.createSpan({ text: path });
	}

	if (showNoteCount) {
		el.createDiv({ cls: "suggestion-aux" }).createSpan({
			cls: "suggestion-flair",
			text: value.notes === 1 ? "1 note" : `${value.notes} notes`,
		});
	}
	if (!Platform.isMobile) el.setAttribute("title", value.url);
}
