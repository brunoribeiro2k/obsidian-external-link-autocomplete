/*
 * Pure string helpers shared by the scanner, index, ranking and suggester.
 * No `obsidian` import, so everything here is unit-testable under Node.
 */

/** Half-open `[start, end)` character ranges, the shape `renderMatches` takes. */
export type Matches = [number, number][];

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s/;

/**
 * Folds one character for matching: compatibility-decomposed, diacritics
 * stripped and lowercased, so `É`, `e` and `ｅ` all fold to `e`.
 */
function foldChar(char: string): string {
	return char.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();
}

/**
 * The matching key for a text: NFKC-style folding, lowercase, diacritics
 * stripped, whitespace collapsed to single spaces and trimmed. Only used for
 * matching; the original text is kept for display and insertion.
 */
export function fold(text: string): string {
	const { folded } = foldWithMap(text);
	// Hand back the original when nothing changed, so the index doesn't hold
	// two copies of the same string.
	return folded === text ? text : folded;
}

/**
 * Like `fold`, plus `map[i]`: the index in `text` where folded character `i`
 * came from. Lets a match found on the folded key be highlighted on the
 * original text.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
	let folded = "";
	const map: number[] = [];
	let pendingSpace = -1;
	let index = 0;
	for (const char of text) {
		if (WHITESPACE.test(char)) {
			if (folded.length > 0 && pendingSpace < 0) pendingSpace = index;
		} else {
			if (pendingSpace >= 0) {
				folded += " ";
				map.push(pendingSpace);
				pendingSpace = -1;
			}
			for (const out of foldChar(char)) {
				folded += out;
				map.push(index);
			}
		}
		index += char.length;
	}
	return { folded, map };
}

/**
 * Maps ranges on a folded key back onto the original text, using the map
 * from `foldWithMap`. Adjacent ranges are merged.
 */
export function mapMatches(matches: Matches, map: number[], text: string): Matches {
	const out: Matches = [];
	for (const [start, end] of matches) {
		if (start >= end || start >= map.length) continue;
		const from = map[start];
		const last = map[Math.min(end, map.length) - 1];
		const to = last + codePointLength(text, last);
		const previous = out[out.length - 1];
		if (previous && previous[1] >= from) {
			previous[1] = Math.max(previous[1], to);
		} else {
			out.push([from, to]);
		}
	}
	return out;
}

function codePointLength(text: string, index: number): number {
	const code = text.codePointAt(index);
	return code !== undefined && code > 0xffff ? 2 : 1;
}

/**
 * The link text as a reader sees it: inline Markdown markers (`**`, `_`,
 * `` ` ``, `~~`, `==`) removed and backslash escapes resolved. Used for
 * matching and display; the raw text is what gets inserted.
 */
export function stripMarkdown(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "\\" && i + 1 < text.length) {
			out += text[i + 1];
			i++;
		} else if (char === "*" || char === "_" || char === "`") {
			continue;
		} else if ((char === "~" || char === "=") && text[i + 1] === char) {
			i++;
		} else {
			out += char;
		}
	}
	return out.trim();
}

/** The most common value; ties go to the lexically smallest, for stability. */
export function mostFrequent(values: readonly string[]): string {
	if (values.length === 1) return values[0];
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best = "";
	let bestCount = -1;
	for (const [value, count] of counts) {
		if (count > bestCount || (count === bestCount && value < best)) {
			best = value;
			bestCount = count;
		}
	}
	return best;
}

/** Whether a destination is an `http:` or `https:` URL. */
export function isHttpUrl(url: string): boolean {
	return /^https?:\/\/\S/i.test(url);
}

interface UrlParts {
	scheme: string;
	host: string;
	/** Everything after the host: path, query and fragment. */
	rest: string;
}

function splitUrl(url: string): UrlParts | null {
	const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(url);
	if (!match) return null;
	return { scheme: match[1], host: match[2], rest: match[3] };
}

/** The bare host of a URL: no user info, no port, lowercased. */
export function hostOf(url: string): string {
	const parts = splitUrl(url);
	if (!parts) return "";
	const host = parts.host.slice(parts.host.lastIndexOf("@") + 1);
	return host.replace(/:\d*$/, "").toLowerCase();
}

/**
 * The dedupe key for a URL: scheme and host lowercased, and a trailing `/`
 * dropped from the path. Queries and fragments are kept. Never inserted.
 */
export function normUrl(url: string): string {
	const parts = splitUrl(url);
	if (!parts) return url;
	const cut = parts.rest.search(/[?#]/);
	let path = cut < 0 ? parts.rest : parts.rest.slice(0, cut);
	const tail = cut < 0 ? "" : parts.rest.slice(cut);
	if (path.endsWith("/")) path = path.slice(0, -1);
	const normalized = `${parts.scheme.toLowerCase()}://${parts.host.toLowerCase()}${path}${tail}`;
	return normalized === url ? url : normalized;
}

/**
 * The secondary line of a suggestion row: the host without `www.`, then `›`,
 * then the path, middle-ellipsized to about `maxPath` characters.
 */
export function describeUrl(url: string, maxPath = 48): { host: string; path: string } {
	const parts = splitUrl(url);
	if (!parts) return { host: url, path: "" };
	const host = hostOf(url).replace(/^www\./, "");
	let path = parts.rest.replace(/^\/+/, "").replace(/\/$/, "");
	if (path.length > maxPath) {
		const head = Math.ceil((maxPath - 1) / 2);
		const tail = maxPath - 1 - head;
		path = `${path.slice(0, head)}…${path.slice(path.length - tail)}`;
	}
	return { host, path };
}

/**
 * Compiles glob-like domain patterns (`*.internal.example.com`, `example.org`)
 * into one predicate over hosts. `*` matches any run of characters.
 */
export function domainMatcher(patterns: string[]): (host: string) => boolean {
	const sources = patterns
		.map((pattern) => pattern.trim().toLowerCase())
		.filter((pattern) => pattern.length > 0)
		.map((pattern) =>
			pattern
				.split("*")
				.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
				.join(".*"),
		);
	if (sources.length === 0) return () => false;
	const regex = new RegExp(`^(?:${sources.join("|")})$`);
	return (host) => regex.test(host);
}

/**
 * A destination ready to write between `(` and `)`: wrapped in `<…>` when it
 * holds whitespace, angle brackets or unbalanced parentheses.
 */
export function formatDestination(url: string): string {
	let depth = 0;
	let balanced = true;
	for (const char of url) {
		if (char === "(") depth++;
		else if (char === ")" && --depth < 0) balanced = false;
	}
	if (depth !== 0) balanced = false;
	if (balanced && !/[\s<>]/.test(url)) return url;
	return `<${url.replace(/[<>]/g, (char) => (char === "<" ? "%3C" : "%3E"))}>`;
}

/** Escapes every unescaped `|`, for text inserted into a table row. */
export function escapePipes(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "\\" && i + 1 < text.length) {
			out += char + text[i + 1];
			i++;
		} else {
			out += char === "|" ? "\\|" : char;
		}
	}
	return out;
}
