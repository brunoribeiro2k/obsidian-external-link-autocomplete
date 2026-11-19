/*
 * Plans vault-wide link edits. Pure: no `obsidian` import.
 *
 * Plans are always made against the content being edited, at the moment of
 * editing, so offsets can't go stale: the preview plans against what was
 * read, and applying plans again against what's there then.
 */

import type { LinkPair } from "./index.ts";
import { encodeScalar, plainSafe, propertyLinks } from "./frontmatter.ts";
import { scan, type LineRange, type Occurrence, type PropertyValue } from "./scanner.ts";
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
 * are replaced, so a link's title and spacing survive. With `properties`,
 * links in frontmatter values are planned too, escaped for their quoting;
 * `skip` must then cover the frontmatter, as `fallbackSkipRanges` does.
 */
export function planRewrite(content: string, skip: LineRange[], spec: RewriteSpec, properties = false): LinkChange[] {
	const lines = content.split(/\r?\n/);
	const body = scan(content, skip);
	const occurrences = properties ? [...propertyLinks(lines), ...body] : body;
	const changes: LinkChange[] = [];
	const requoted = new Set<string>();
	for (const occurrence of occurrences) {
		if (!matchesSpec(occurrence, spec)) continue;
		const value = occurrence.property;
		let edits: LineEdit[];
		if (!value) {
			const escape = isTableRow(lines[occurrence.line]) ? escapePipes : (text: string) => text;
			edits = linkEdits(occurrence, spec, escape);
		} else if (value.style !== "plain" || (plainSafe(spec.text) && plainSafe(formatDestination(spec.url)))) {
			edits = linkEdits(occurrence, spec, (text) => encodeScalar(text, value.style));
		} else {
			const id = `${occurrence.line}:${value.start}`;
			if (requoted.has(id)) continue;
			requoted.add(id);
			const change = requote(lines[occurrence.line], occurrence.line, value, occurrences, spec);
			if (change) changes.push(change);
			continue;
		}
		if (edits.length > 0) {
			changes.push({ line: occurrence.line, start: occurrence.start, end: occurrence.end, edits });
		}
	}
	return changes;
}

/** The edits turning one link into the spec's text and URL, with `escape` applied to what's inserted. */
function linkEdits(occurrence: Occurrence, spec: RewriteSpec, escape: (text: string) => string): LineEdit[] {
	const edits: LineEdit[] = [];
	if (occurrence.text !== spec.text) {
		edits.push({ from: occurrence.start + 1, to: occurrence.textEnd, insert: escape(spec.text) });
	}
	if (occurrence.url !== spec.url) {
		edits.push({ from: occurrence.urlStart, to: occurrence.urlEnd, insert: escape(formatDestination(spec.url)) });
	}
	return edits;
}

/**
 * Rewrites the spec's links in an unquoted property value that can't hold
 * the new text or URL as is, by turning the whole value into a
 * double-quoted scalar. Unquoted, the raw value is the decoded one.
 */
function requote(
	lineText: string,
	line: number,
	value: PropertyValue,
	occurrences: readonly Occurrence[],
	spec: RewriteSpec,
): LinkChange | null {
	const edits = occurrences
		.filter((other) => other.line === line && other.property?.start === value.start && matchesSpec(other, spec))
		.flatMap((other) => linkEdits(other, spec, (text) => text))
		.sort((a, b) => b.from - a.from);
	if (edits.length === 0) return null;
	let scalar = lineText.slice(value.start, value.end);
	for (const edit of edits) {
		scalar = scalar.slice(0, edit.from - value.start) + edit.insert + scalar.slice(edit.to - value.start);
	}
	const insert = `"${encodeScalar(scalar, "double")}"`;
	return { line, start: value.start, end: value.end, edits: [{ from: value.start, to: value.end, insert }] };
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

/** A link as a rewrite left it: where it is now, and its source before and after. */
export interface AppliedLink {
	line: number;
	/** Column where the rewritten link starts. */
	start: number;
	before: string;
	after: string;
}

/** Records what `changes` do to `content`, so they can be reverted later. */
export function appliedLinks(content: string, changes: LinkChange[]): AppliedLink[] {
	const lines = content.split(/\r?\n/);
	const out: AppliedLink[] = [];
	let line = -1;
	let shift = 0;
	for (const change of changes) {
		if (change.line !== line) {
			line = change.line;
			shift = 0;
		}
		const before = lines[line].slice(change.start, change.end);
		let after = before;
		for (const edit of [...change.edits].sort((a, b) => b.from - a.from)) {
			after = after.slice(0, edit.from - change.start) + edit.insert + after.slice(edit.to - change.start);
		}
		out.push({ line, start: change.start + shift, before, after });
		shift += after.length - before.length;
	}
	return out;
}

/**
 * Changes that put the links back as they were, for each link still on its
 * line exactly as the rewrite left it. Edits elsewhere on the line may have
 * moved it, so the closest unclaimed copy counts. The others are skipped.
 */
export function planRevert(content: string, applied: AppliedLink[]): { changes: LinkChange[]; skipped: number } {
	const lines = content.split(/\r?\n/);
	const claimed = new Set<string>();
	const changes: LinkChange[] = [];
	let skipped = 0;
	for (const link of applied) {
		const text = lines[link.line] ?? "";
		let best = -1;
		for (let at = text.indexOf(link.after); at >= 0; at = text.indexOf(link.after, at + 1)) {
			if (claimed.has(`${link.line}:${at}`)) continue;
			if (best < 0 || Math.abs(at - link.start) < Math.abs(best - link.start)) best = at;
		}
		if (best < 0) {
			skipped++;
			continue;
		}
		claimed.add(`${link.line}:${best}`);
		const end = best + link.after.length;
		changes.push({ line: link.line, start: best, end, edits: [{ from: best, to: end, insert: link.before }] });
	}
	return { changes, skipped };
}
