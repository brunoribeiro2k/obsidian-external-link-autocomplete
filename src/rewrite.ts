/*
 * Plans vault-wide link edits. Pure: no `obsidian` import.
 *
 * Plans are always made against the content being edited, at the moment of
 * editing, so offsets can't go stale: the preview plans against what was
 * read, and applying plans again against what's there then.
 */

import type { LinkPair } from "./index.ts";
import { scan, type LineRange, type Occurrence } from "./scanner.ts";
import { escapePipes, fold, formatDestination, normUrl, stripMarkdown } from "./text.ts";
import { isTableRow } from "./trigger.ts";

export interface RewriteSpec {
	/** The pair being edited, keyed like the index. */
	key: string;
	urlKey: string;
	/** Also edit links to the same URL with other texts. */
	allTexts: boolean;
	/** What every matched link becomes. */
	text: string;
	url: string;
	/** The index's ignore-list filter; links it drops are never edited. */
	keep: (pair: LinkPair) => boolean;
}

/** One replacement on one line, in columns. */
export interface LineEdit {
	from: number;
	to: number;
	insert: string;
}

/** One link that will change. */
export interface LinkChange {
	line: number;
	/** The link's columns on the line before the edit. */
	start: number;
	end: number;
	edits: LineEdit[];
}

/** Whether a scanned link is one the spec edits. */
export function matchesSpec(occurrence: Occurrence, spec: RewriteSpec): boolean {
	if (normUrl(occurrence.url) !== spec.urlKey || !spec.keep(occurrence)) return false;
	return spec.allTexts || fold(stripMarkdown(occurrence.text)) === spec.key;
}

/**
 * The links in `content` that the spec changes. Only the parts that differ
 * are replaced, so a link's title and spacing survive.
 */
export function planRewrite(content: string, skip: LineRange[], spec: RewriteSpec): LinkChange[] {
	const lines = content.split(/\r?\n/);
	const changes: LinkChange[] = [];
	for (const occurrence of scan(content, skip)) {
		if (!matchesSpec(occurrence, spec)) continue;
		const inTable = isTableRow(lines[occurrence.line]);
		const edits: LineEdit[] = [];
		if (occurrence.text !== spec.text) {
			edits.push({
				from: occurrence.start + 1,
				to: occurrence.textEnd,
				insert: inTable ? escapePipes(spec.text) : spec.text,
			});
		}
		if (occurrence.url !== spec.url) {
			const destination = formatDestination(spec.url);
			edits.push({
				from: occurrence.urlStart,
				to: occurrence.urlEnd,
				insert: inTable ? escapePipes(destination) : destination,
			});
		}
		if (edits.length > 0) {
			changes.push({ line: occurrence.line, start: occurrence.start, end: occurrence.end, edits });
		}
	}
	return changes;
}

/** `content` with the changes applied; line endings are kept as they were. */
export function applyChanges(content: string, changes: LinkChange[]): string {
	const lineStarts = [0];
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") lineStarts.push(i + 1);
	}
	const edits = changes
		.flatMap((change) => change.edits.map((edit) => ({ ...edit, offset: lineStarts[change.line] })))
		.sort((a, b) => b.offset + b.from - (a.offset + a.from));
	let out = content;
	for (const edit of edits) {
		out = out.slice(0, edit.offset + edit.from) + edit.insert + out.slice(edit.offset + edit.to);
	}
	return out;
}

/** The link under column `ch` of a line, if any. */
export function linkAt(lineText: string, ch: number): Occurrence | null {
	return scan(lineText).find((occurrence) => occurrence.start <= ch && ch <= occurrence.end) ?? null;
}

/**
 * Whether `[text](url)` reads back as exactly that link: a non-empty text
 * that doesn't break the brackets, and an http(s) URL.
 */
export function isValidLink(text: string, url: string): boolean {
	if (text.trim() !== text || url.trim() !== url) return false;
	const found = scan(`[${text}](${formatDestination(url)})`);
	return found.length === 1 && found[0].text === text && found[0].url === url;
}
