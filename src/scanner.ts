/*
 * Finds `[text](http…)` links in a note. Pure: no `obsidian` import.
 *
 * One pass per line, skipping fenced code and frontmatter (from the metadata
 * cache's sections when available, see `fallbackSkipRanges` otherwise) and
 * inline code spans. Parentheses in URLs, `<…>` destinations, link titles,
 * nested brackets and backslash escapes are handled; a single regex can't.
 */

import { isHttpUrl } from "./text.ts";

export interface Occurrence {
	/** The raw text between the brackets, as written. */
	text: string;
	/** The destination, without `<…>` wrapping. */
	url: string;
	/** Zero-based line number. */
	line: number;
	/** Column of the opening `[`. */
	start: number;
	/** Column just after the closing `)`. */
	end: number;
}

/** Inclusive zero-based line ranges the scanner must not look at. */
export type LineRange = [number, number];

/** Texts longer than this aren't link labels anyone would retype. */
export const MAX_TEXT_LENGTH = 120;

export function scan(text: string, skip: LineRange[] = []): Occurrence[] {
	const lines = text.split(/\r?\n/);
	const sorted = [...skip].sort((a, b) => a[0] - b[0]);
	const out: Occurrence[] = [];
	let range = 0;
	for (let line = 0; line < lines.length; line++) {
		while (range < sorted.length && sorted[range][1] < line) range++;
		if (range < sorted.length && sorted[range][0] <= line) continue;
		const content = lines[line];
		if (content.indexOf("](") < 0) continue;
		scanLine(content, line, out);
	}
	return out;
}

function scanLine(content: string, line: number, out: Occurrence[]): void {
	let i = 0;
	while (i < content.length) {
		const char = content[i];
		if (char === "\\") {
			i += 2;
		} else if (char === "`") {
			i = skipCodeSpan(content, i);
		} else if (char === "[") {
			i = scanBracket(content, i, line, out);
		} else {
			i++;
		}
	}
}

/** Returns the index after the inline code span opening at `start`. */
function skipCodeSpan(content: string, start: number): number {
	let end = start;
	while (content[end] === "`") end++;
	const fence = content.slice(start, end);
	let search = end;
	for (;;) {
		const close = content.indexOf(fence, search);
		// An unclosed run is literal backticks, not a code span.
		if (close < 0) return end;
		let after = close + fence.length;
		if (content[after] !== "`") return after;
		while (content[after] === "`") after++;
		search = after;
	}
}

/**
 * Handles a `[` at `start`. Records a link when one starts here, and returns
 * where scanning continues: after the link, or just after the `[` so links
 * nested in a non-link bracket are still found.
 */
function scanBracket(content: string, start: number, line: number, out: Occurrence[]): number {
	const next = content[start + 1];
	if (next === "[") {
		// Wikilink: skip to its `]]`.
		const close = content.indexOf("]]", start + 2);
		return close < 0 ? start + 2 : close + 2;
	}
	const isImage = start > 0 && content[start - 1] === "!";
	const isFootnote = next === "^";

	const close = matchBracket(content, start);
	if (close < 0 || content[close + 1] !== "(") return start + 1;
	const destination = parseDestination(content, close + 2);
	if (!destination) return start + 1;

	const text = content.slice(start + 1, close);
	const trimmed = text.trim();
	if (
		!isImage &&
		!isFootnote &&
		trimmed.length > 0 &&
		trimmed.length <= MAX_TEXT_LENGTH &&
		!trimmed.includes("![") &&
		isHttpUrl(destination.url)
	) {
		out.push({ text: detach(trimmed), url: detach(destination.url), line, start, end: destination.end });
	}
	return destination.end;
}

/**
 * A copy of `value` that doesn't reference the note it was sliced from.
 * JS engines may implement `slice` as a view into the parent string, which
 * would keep every scanned note body alive for as long as the index holds a
 * link from it.
 */
function detach(value: string): string {
	return ` ${value}`.slice(1);
}

/** Index of the `]` matching the `[` at `start`, or -1. */
function matchBracket(content: string, start: number): number {
	let depth = 0;
	for (let i = start; i < content.length; i++) {
		const char = content[i];
		if (char === "\\") {
			i++;
		} else if (char === "`") {
			i = skipCodeSpan(content, i) - 1;
		} else if (char === "[") {
			depth++;
		} else if (char === "]" && --depth === 0) {
			return i;
		}
	}
	return -1;
}

/**
 * Parses `url)`, `<url>)`, `url "title")` and friends, starting just after
 * the `(`. Returns the URL and the index after the closing `)`, or null.
 */
function parseDestination(content: string, from: number): { url: string; end: number } | null {
	let i = skipSpaces(content, from);
	let url: string;
	if (content[i] === "<") {
		const close = content.indexOf(">", i + 1);
		if (close < 0) return null;
		url = content.slice(i + 1, close);
		if (url.includes("<")) return null;
		i = close + 1;
	} else {
		const start = i;
		let depth = 0;
		for (; i < content.length; i++) {
			const char = content[i];
			if (char === "\\") {
				i++;
			} else if (char === "(") {
				depth++;
			} else if (char === ")") {
				if (depth === 0) break;
				depth--;
			} else if (char === " " || char === "\t") {
				break;
			}
		}
		if (depth !== 0) return null;
		url = content.slice(start, i);
	}

	i = skipSpaces(content, i);
	const opener = content[i];
	if (opener === '"' || opener === "'" || opener === "(") {
		const closer = opener === "(" ? ")" : opener;
		let j = i + 1;
		for (; j < content.length && content[j] !== closer; j++) {
			if (content[j] === "\\") j++;
		}
		if (j >= content.length) return null;
		i = skipSpaces(content, j + 1);
	}
	if (content[i] !== ")") return null;
	return { url: url.trim(), end: i + 1 };
}

function skipSpaces(content: string, from: number): number {
	let i = from;
	while (content[i] === " " || content[i] === "\t") i++;
	return i;
}

/**
 * Skip ranges for when the metadata cache has nothing for a file yet:
 * frontmatter at the top, and fenced code blocks (``` or ~~~).
 */
export function fallbackSkipRanges(text: string): LineRange[] {
	const lines = text.split(/\r?\n/);
	const ranges: LineRange[] = [];
	let line = 0;
	if (lines[0] === "---") {
		for (let end = 1; end < lines.length; end++) {
			if (lines[end] === "---" || lines[end] === "...") {
				ranges.push([0, end]);
				line = end + 1;
				break;
			}
		}
	}
	for (; line < lines.length; line++) {
		const open = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[line]);
		if (!open) continue;
		const fence = open[1];
		let end = line + 1;
		while (end < lines.length) {
			const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(lines[end]);
			if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
			end++;
		}
		ranges.push([line, Math.min(end, lines.length - 1)]);
		line = end;
	}
	return ranges;
}
