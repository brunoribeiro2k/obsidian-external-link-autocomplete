/*
 * Decides whether the cursor sits in a link text being typed. Pure: no
 * `obsidian` import. Runs on every keypress, so it bails out early and does
 * nothing heavier than a bounded scan of the current line.
 */

import { MAX_TEXT_LENGTH } from "./scanner.ts";

export interface TriggerMatch {
	/** Column of the opening `[`; the replacement starts here. */
	start: number;
	/** Column where the replacement ends: after an auto-paired `]` if there is one. */
	end: number;
	/** The text between `[` and the cursor. */
	query: string;
}

const LIST_MARKER = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+$/;

/**
 * `lineText` is the whole line and `ch` the cursor column. Returns null for
 * anything that isn't a fresh `[…` link text: `[[`, `![`, `[^`, task boxes,
 * escaped brackets, inline code, and brackets that already have a `](…)`.
 */
export function findTrigger(lineText: string, ch: number): TriggerMatch | null {
	let open = -1;
	const floor = Math.max(0, ch - MAX_TEXT_LENGTH - 1);
	for (let i = ch - 1; i >= floor; i--) {
		const char = lineText[i];
		if (char === "[") {
			open = i;
			break;
		}
		if (char === "]") return null;
	}
	if (open < 0) return null;

	const before = open > 0 ? lineText[open - 1] : "";
	if (before === "[" || before === "!" || before === "\\") return null;

	const query = lineText.slice(open + 1, ch);
	if (query.startsWith("^")) return null;
	if (query.length <= 1 && LIST_MARKER.test(lineText.slice(0, open))) return null;
	if (insideInlineCode(lineText, open)) return null;

	const rest = lineText.slice(ch);
	if (/^[^[\]]*\]\(/.test(rest)) return null;
	const closing = /^[^[\]]*\]/.exec(rest);
	const end = closing ? ch + closing[0].length : ch;

	return { start: open, end, query };
}

/** Whether `index` falls inside an inline code span, by backtick parity. */
function insideInlineCode(lineText: string, index: number): boolean {
	let ticks = 0;
	for (let i = 0; i < index; i++) {
		if (lineText[i] === "`") ticks++;
	}
	return ticks % 2 === 1;
}

/** Whether a line is a table row, so inserted text must escape `|`. */
export function isTableRow(lineText: string): boolean {
	return /^\s*(?:>\s*)*\|/.test(lineText);
}
