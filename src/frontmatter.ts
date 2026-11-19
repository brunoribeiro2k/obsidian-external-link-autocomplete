/*
 * Links in a note's frontmatter properties. Pure: no `obsidian` import.
 *
 * Reads the YAML the way the Properties view writes it: top-level keys whose
 * value fits on its line, a scalar or a list of scalars (`- …` lines or a
 * flow `[…]`). Quoted scalars are decoded before the line scan runs over
 * them, and every column is mapped back to the raw line, so a link can be
 * rewritten in place without reformatting the YAML. Comments, nested maps,
 * block scalars and multi-line values are skipped.
 */

import { frontmatterRange, scanText, type Occurrence, type PropertyValue, type ScalarStyle } from "./scanner.ts";

/** One single-line scalar in a property's value. */
interface Scalar {
	style: ScalarStyle;
	/** Raw columns of the scalar, quotes included. */
	start: number;
	end: number;
	/** The decoded value. */
	value: string;
	/** `map[i]` is the raw column where decoded character `i` starts; `map[value.length]` is where the value ends. */
	map: number[];
}

/** A line holding (part of) a property's value. */
interface ValueLine {
	line: number;
	property: string;
	/** Column where the value starts, after `key:` or `-` and spaces. */
	start: number;
	/** Whether the value is a flow list, `[…]`. */
	flow: boolean;
	scalars: Scalar[];
	/** A quoted scalar still open at the end of the line, as while it's being typed. */
	unclosed?: { style: "double" | "single"; start: number };
}

/** How a link is written at a spot in a property value; `wrap` puts it in a new double-quoted scalar. */
export type InsertStyle = ScalarStyle | "wrap";
/** Where a typed link goes: the note's text, or a property value written in that style. */
export type LinkContext = "body" | InsertStyle;

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#"'][^:]*?)[ \t]*:(?=[ \t]|$)/;
const ITEM = /^[ \t]*-(?=[ \t]|$)/;
const BLOCK_SCALAR = /^[|>][-+0-9]*[ \t]*(?:#.*)?$/;
/** Plain scalars can't start with these; values that do are something else, or not worth guessing. */
const NOT_PLAIN = /^(?:[{&*!%@`|>]|[-?:](?:[ \t]|$))/;

/** Escapes in double-quoted YAML scalars that stand for one character. */
const ESCAPES: Record<string, string> = {
	"0": "\0",
	a: "\x07",
	b: "\b",
	t: "\t",
	"\t": "\t",
	n: "\n",
	v: "\v",
	f: "\f",
	r: "\r",
	e: "\x1b",
	" ": " ",
	'"': '"',
	"/": "/",
	"\\": "\\",
	N: "\u0085",
	_: " ",
	L: " ",
	P: " ",
};
const HEX_DIGITS: Record<string, number> = { x: 2, u: 4, U: 8 };

/** Every `[text](http…)` link in the frontmatter's property values, with columns on the raw lines. */
export function propertyLinks(lines: readonly string[]): Occurrence[] {
	const out: Occurrence[] = [];
	for (const value of parse(lines)) {
		for (const scalar of value.scalars) {
			const property: PropertyValue = { name: value.property, style: scalar.style, start: scalar.start, end: scalar.end };
			for (const found of scanText(scalar.value)) {
				const { map } = scalar;
				out.push({
					text: found.text,
					url: found.url,
					line: value.line,
					start: map[found.start],
					end: map[found.end],
					textEnd: map[found.textEnd],
					urlStart: map[found.urlStart],
					urlEnd: map[found.urlEnd],
					property,
				});
			}
		}
	}
	return out;
}

/** `propertyLinks` for a whole note. */
export function scanFrontmatter(text: string): Occurrence[] {
	if (!text.startsWith("---")) return [];
	return propertyLinks(text.split(/\r?\n/));
}

/** The property link under column `ch` of a frontmatter line, if any. */
export function propertyLinkAt(lines: readonly string[], line: number, ch: number): Occurrence | null {
	return propertyLinks(lines).find((link) => link.line === line && link.start <= ch && ch <= link.end) ?? null;
}

/**
 * How a link typed with its `[` at column `open` of a frontmatter line must
 * be written: escaped for the quoted scalar it's in, as is in a plain one,
 * or wrapped in double quotes where it starts the value (YAML would read a
 * `[` there as a list). Null when the column isn't in a property's value.
 */
export function insertionStyle(lines: readonly string[], line: number, open: number): InsertStyle | null {
	const value = parse(lines).find((candidate) => candidate.line === line);
	if (!value || open < value.start) return null;
	for (const scalar of value.scalars) {
		const last = scalar.style === "plain" ? scalar.end : scalar.end - 1;
		if (open > scalar.start && open < last) return scalar.style;
	}
	if (value.unclosed && open > value.unclosed.start) return value.unclosed.style;
	if (open === value.start) return "wrap";
	if (value.flow && !value.scalars.some((scalar) => scalar.start < open && open < scalar.end)) {
		const before = lines[line].slice(value.start, open).trimEnd();
		if (before.endsWith("[") || before.endsWith(",")) return "wrap";
	}
	return null;
}

/** `text` written into a scalar of the given style. */
export function encodeScalar(text: string, style: ScalarStyle): string {
	if (style === "double") return text.replace(/[\\"]/g, (char) => `\\${char}`);
	if (style === "single") return text.replace(/'/g, "''");
	return text;
}

/** Whether `text` can go inside an unquoted scalar without ending it or starting a comment. */
export function plainSafe(text: string): boolean {
	return !/:[ \t]|[ \t]#/.test(text);
}

function parse(lines: readonly string[]): ValueLine[] {
	const range = frontmatterRange(lines);
	if (!range) return [];
	const out: ValueLine[] = [];
	let property: string | null = null;
	/** Inside a block scalar: the lines indented deeper than this belong to it. */
	let blockIndent = -1;
	for (let line = range[0] + 1; line < range[1]; line++) {
		const content = lines[line];
		const indent = indentOf(content);
		if (blockIndent >= 0) {
			if (indent > blockIndent || indent === content.length) continue;
			blockIndent = -1;
		}
		if (indent === content.length || content[indent] === "#") continue;

		let from: number;
		const item = ITEM.exec(content);
		const key = item || indent > 0 ? null : KEY.exec(content);
		if (item) {
			if (property === null) continue;
			from = item[0].length;
		} else if (key) {
			property = unquoteKey(key[1]);
			from = key[0].length;
		} else {
			// A nested map, or something this reader doesn't follow.
			if (indent === 0) property = null;
			continue;
		}
		const value = parseValue(content, from, line, property);
		if (value === "block") blockIndent = indent;
		else out.push(value);
	}
	return out;
}

function parseValue(content: string, from: number, line: number, property: string): ValueLine | "block" {
	const start = skipSpaces(content, from);
	const char = content[start];
	const value: ValueLine = { line, property, start, flow: char === "[", scalars: [] };
	if (start >= content.length || char === "#") return value;
	if (char === '"' || char === "'") {
		const scalar = quoted(content, start);
		if (!scalar) value.unclosed = { style: char === '"' ? "double" : "single", start };
		else if (isLineEnd(content, scalar.end)) value.scalars.push(scalar);
	} else if (char === "[") {
		flowItems(content, start + 1, value);
	} else if (char === "|" || char === ">") {
		if (BLOCK_SCALAR.test(content.slice(start))) return "block";
	} else if (!NOT_PLAIN.test(content.slice(start))) {
		const scalar = plain(content, start);
		if (scalar) value.scalars.push(scalar);
	}
	return value;
}

/** The quoted items of a flow list starting just after its `[`. */
function flowItems(content: string, from: number, value: ValueLine): void {
	let i = from;
	for (;;) {
		i = skipSpaces(content, i);
		const char = content[i];
		if (char === undefined || char === "]") return;
		if (char === '"' || char === "'") {
			const scalar = quoted(content, i);
			if (!scalar) {
				value.unclosed = { style: char === '"' ? "double" : "single", start: i };
				return;
			}
			value.scalars.push(scalar);
			i = scalar.end;
		} else {
			// A plain item can't hold brackets, so it has no link; nested lists and maps aren't followed.
			if (char === "[" || char === "{") return;
			while (i < content.length && content[i] !== "," && content[i] !== "]") i++;
		}
		i = skipSpaces(content, i);
		if (content[i] !== ",") return;
		i++;
	}
}

/** The quoted scalar opening at `open`, decoded, or null when it doesn't close on this line. */
function quoted(content: string, open: number): Scalar | null {
	const quote = content[open];
	let value = "";
	const map: number[] = [];
	let i = open + 1;
	while (i < content.length) {
		const char = content[i];
		if (char === quote) {
			if (quote === "'" && content[i + 1] === "'") {
				value += "'";
				map.push(i);
				i += 2;
				continue;
			}
			map.push(i);
			return { style: quote === '"' ? "double" : "single", start: open, end: i + 1, value, map };
		}
		if (char === "\\" && quote === '"' && i + 1 < content.length) {
			const decoded = unescape(content, i);
			value += decoded.text;
			for (let k = 0; k < decoded.text.length; k++) map.push(i);
			i += decoded.length;
			continue;
		}
		value += char;
		map.push(i);
		i++;
	}
	return null;
}

/** The escape at `at` (a backslash) in a double-quoted scalar: what it stands for and its raw length. */
function unescape(content: string, at: number): { text: string; length: number } {
	const next = content[at + 1];
	const simple = ESCAPES[next];
	if (simple !== undefined) return { text: simple, length: 2 };
	const digits = HEX_DIGITS[next];
	if (digits !== undefined) {
		const hex = content.slice(at + 2, at + 2 + digits);
		const code = hex.length === digits && /^[0-9a-f]+$/i.test(hex) ? parseInt(hex, 16) : -1;
		if (code >= 0 && code <= 0x10ffff) return { text: String.fromCodePoint(code), length: 2 + digits };
	}
	// Not valid YAML; keep it as written.
	return { text: `\\${next}`, length: 2 };
}

/** An unquoted scalar starting at `start`, up to a comment or the end of the line. */
function plain(content: string, start: number): Scalar | null {
	const comment = content.slice(start).search(/[ \t]#/);
	let end = comment < 0 ? content.length : start + comment;
	while (end > start && (content[end - 1] === " " || content[end - 1] === "\t")) end--;
	const value = content.slice(start, end);
	// `a: b` is a map, not a scalar.
	if (/:(?:[ \t]|$)/.test(value)) return null;
	const map: number[] = [];
	for (let i = start; i <= end; i++) map.push(i);
	return { style: "plain", start, end, value, map };
}

function unquoteKey(key: string): string {
	if (key.startsWith('"')) return quoted(key, 0)?.value ?? key;
	if (key.startsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
	return key;
}

/** Whether only spaces or a comment follow column `from`. */
function isLineEnd(content: string, from: number): boolean {
	const i = skipSpaces(content, from);
	return i >= content.length || content[i] === "#";
}

function indentOf(content: string): number {
	let i = 0;
	while (content[i] === " " || content[i] === "\t") i++;
	return i;
}

function skipSpaces(content: string, from: number): number {
	let i = from;
	while (content[i] === " " || content[i] === "\t") i++;
	return i;
}
