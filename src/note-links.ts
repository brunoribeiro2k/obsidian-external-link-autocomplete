/*
 * The external links one note uses, for the section at the end of the note.
 * Pure: no `obsidian` import.
 */

import type { Occurrence } from "./scanner.ts";
import { fold, normUrl, stripMarkdown } from "./text.ts";

/** One URL a note links to, however many times and with whatever texts. */
export interface NoteLink {
	urlKey: string;
	/** The URL as first written in the note. */
	url: string;
	/** Distinct texts (by folded, stripped text), as first written, in order. */
	texts: string[];
	/** How many links in the note point at the URL. */
	count: number;
	/** The first link to the URL, for jumping to it. */
	first: Occurrence;
}

/** Groups a note's links by URL, in the order the URLs first appear. */
export function noteLinks(occurrences: readonly Occurrence[]): NoteLink[] {
	const byUrl = new Map<string, { link: NoteLink; keys: Set<string> }>();
	for (const occurrence of occurrences) {
		const urlKey = normUrl(occurrence.url);
		const key = fold(stripMarkdown(occurrence.text));
		const entry = byUrl.get(urlKey);
		if (!entry) {
			const link = { urlKey, url: occurrence.url, texts: [occurrence.text], count: 1, first: occurrence };
			byUrl.set(urlKey, { link, keys: new Set([key]) });
			continue;
		}
		entry.link.count++;
		if (!entry.keys.has(key)) {
			entry.keys.add(key);
			entry.link.texts.push(occurrence.text);
		}
	}
	return [...byUrl.values()].map((entry) => entry.link);
}
