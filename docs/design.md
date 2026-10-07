# External Link Autocomplete — design

Design doc for a community plugin that autocompletes external Markdown links as you type, using links already in the vault. Type `[abc`, pick `abcdef`, get `[abcdef](http://example.com)`. The original brief lives in the author's Obsidian vault.

## TL;DR

- **What:** an `EditorSuggest` that fires inside `[...` (but not `[[`). It suggests link texts taken from `[text](http…)` links already in the vault, and on accept it inserts the whole `[text](url)`.
- **Why a new plugin:** none of the four closest plugins does inline autocomplete for external links. See [Why not extend an existing plugin](#prior-art-and-why-not-extend-an-existing-plugin).
- **The intended approach holds, with five corrections:**
	1. **Auto-pair.** With Obsidian's "Auto pair brackets" setting on, the buffer is `[abc|]`, not an unclosed `[abc`. The trigger must accept a trailing `]` and replace it too.
	2. **Don't index with one regex.** Parentheses in URLs (Wikipedia), `<…>` destinations, link titles and escapes all break a naive pattern. Use a small line scanner.
	3. **Index from `metadataCache.on("changed")`, not `vault.on("modify")`.** The typed callback is `(file, data, cache)`, so it hands over both the file text and `sections`/`frontmatterPosition`. Code blocks and frontmatter can be skipped without reading the file again.
	4. **Rank by distinct notes, not raw occurrences.** One note that repeats a link 50 times shouldn't dominate.
	5. **Prefix beats fuzzy.** Show prefix matches before fuzzy ones, whatever their frequency. Otherwise ranking feels random.
- **MVP:** in-memory index, trigger, native-looking popup, accept, and settings for min chars, ranking, exclusions, ignore list and multi-URL behavior. Title fetching, domain grouping and clipboard capture come later.
- **The two big unknowns are settled** (M0, by reading Obsidian 1.14.4's bundled `app.js`): (a) suggesters run in a list, core's four first, then plugins in registration order, and the first `onTrigger` that returns non-null wins; (b) `CachedMetadata.links` does **not** include `http(s)` Markdown links, so the scanner stays. See [Conflicts](#conflicts-with--and-other-suggesters) and [Scanner](#scanner).

## Prior art and why not extend an existing plugin

**None of the plugins below provides inline autocomplete for external links.** The descriptions come from the prior-art research in the brief and weren't re-checked in this pass.

| Plugin | What it does | Why it doesn't fit |
|---|---|---|
| [External Link Helper](https://www.obsidianstats.com/plugins/obsidian-extlnkhelper-plugin) | Reuses previously used external links | Works through a command-palette search modal, not inline typing, and doesn't match by alias/link text |
| [Link with alias](https://github.com/pvojtechovsky/obsidian-link-with-alias) | Alias-aware link insertion | Internal notes only; keeps aliases in the target note's frontmatter |
| [Inline Link Suggestions](https://community.obsidian.md/plugins/inline-link-suggestions) | Inline suggestions while typing | Internal wikilinks only |
| [Boost Link Suggestions](https://www.obsidianstats.com/plugins/boost-link-suggestions) | Reorders the `[[` popup | Internal notes only |

External Link Helper is the only realistic candidate for a contribution. The gap is architectural, though. Its data and UI are built for a modal, while this feature needs a trigger-driven popup over a text-keyed index that updates incrementally. Retrofitting that is closer to a rewrite than a PR. A small, focused plugin is cheaper, and it can coexist with External Link Helper because the two never compete for the same UI surface.

## Goals, non-goals, user stories

### Goals

- Suggest external links already used in the vault, inline, as you type.
- Useful with zero configuration; settings only tune it.
- No perceptible typing lag on 10k+ note vaults, and no startup stall.
- Fully local, with no network requests.
- Indistinguishable from Obsidian's own suggesters in look and keyboard feel.

### Non-goals

- Internal links (`[[…]]`, `[text](note.md)`), which core and other plugins already cover.
- Links that were never used in the vault: no web search, browser history or bookmark import.
- Page-title fetching in the MVP (see [Privacy](#privacy)).
- Link checking, dead-link detection, or rewriting existing links.
- Image embeds `![alt](url)`.
- Reading view and Canvas cards. Only the Markdown editor is in scope (Source mode and Live Preview).

### User stories

1. When I type `[jira`, I'm offered `[Jira board](https://….atlassian.net/…)`, so I don't go hunting for the URL.
2. When `[docs]` has pointed at several URLs, I see each URL under the text and pick the right one.
3. I get no popup while typing `[[`, a footnote `[^1`, a task `- [ ]`, an image `![`, or inside code and frontmatter.
4. On mobile I tap a suggestion; no hardware keys are needed.
5. I can confirm that nothing leaves my machine.

## Validating the intended approach

| Step | Verdict | Challenge |
|---|---|---|
| 1. Regex index with incremental vault events | Keep the idea, change how it works | Use a scanner instead of a regex. Drive updates from `metadataCache` `changed` (it carries the text and the section map), plus `vault` `rename`/`delete`. |
| 2. Trigger on an unclosed `[…` via `EditorSuggest` | Right API, needs a fix | Auto-pair means `[abc|]` is the common shape. Also exclude `[^`, `- [ ]`, `![`, and `[` inside an existing link. |
| 3. Fuzzy/prefix match, ranked by frequency and recency | Keep, refine | Use tiers (exact > prefix > word-prefix > fuzzy), then a usage score inside each tier. Count distinct notes, not occurrences. |
| 4. Replace the fragment with `[text](url)` | Keep | Replace through the auto-paired `]` and put the cursor after `)`. Escape `|` inside tables. |

## UX

### Popup layout

Match the native `[[` suggester exactly. Subclass `EditorSuggest` and render into the element that `renderSuggestion(value, el)` provides ([PopoverSuggest](https://docs.obsidian.md/Reference/TypeScript+API/PopoverSuggest)). Don't build a custom popup.

```
┌──────────────────────────────────────────────┐
│ Jira board                                   │  ← title, query highlighted
│ example.atlassian.net › …/board/42           │  ← muted secondary line
├──────────────────────────────────────────────┤
│ Jira board                          3 notes  │
│ other.atlassian.net › browse/DATA            │
├──────────────────────────────────────────────┤
│ ↑↓ navigate   ↵ insert   esc dismiss         │  ← setInstructions footer
└──────────────────────────────────────────────┘
```

- **Title line:** the link text, with the matched characters wrapped in the highlight class.
- **Secondary line:** host, then a muted `›`, then a path that's middle-ellipsized to one line. Never show the raw full URL; drop `https://` and `www.`. On desktop the full URL goes in the row's `title` tooltip.
- **Aux (right):** an optional muted "3 notes" count, off by default.
- **Footer:** key hints through `setInstructions` (since 0.13.0, per [EditorSuggest](https://docs.obsidian.md/Reference/TypeScript+API/EditorSuggest)). Hide it on mobile.
- **Row cap:** set `limit` (documented on the same page) to 8 on desktop and 5 on mobile.
- **Styling:** reuse core's suggestion classes (`suggestion-content`, `suggestion-title`, `suggestion-note`, `suggestion-aux`, `suggestion-highlight`, `mod-complex`). These are **not documented API**; they're simply what core renders. Confirm them in devtools on the target version. Any extra CSS uses only theme variables (`--text-muted`, `--text-faint`, `--font-ui-smaller`, `--size-4-1`) and no hardcoded colors, as the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) require ("No hardcoded styling").
- **Matching row heights:** keep rows the same height and the text single-line, so the list doesn't jump around as you type.

**Things that would look dated or clunky, and must be avoided:**

- A full raw URL on the title line, or long URLs that wrap onto several lines.
- A hand-rolled popup with its own shadow, border radius or scroll handling; it never matches every theme.
- Favicons fetched from the network (a privacy leak, and slow) or emoji decoration. Core suggesters use neither. A local, generic `lucide` link icon is acceptable at most, and off by default.
- Rows that look identical with nothing to tell them apart. Always differentiate by host/path.
- Flicker: the popup opening on a stray `[` and closing on the next keystroke. The minimum length prevents this.
- A "loading…" spinner. Lookups are synchronous from memory; if the index isn't ready, show nothing.

### Keyboard

- **↑/↓** navigate, and **Enter** accepts. The base class provides both.
- **Tab** also accepts, as an opt-out setting. Register it on the suggester's `scope` ([PopoverSuggest.scope](https://docs.obsidian.md/Reference/TypeScript+API/PopoverSuggest)), which is only active while the popup is open, so list indentation with Tab is unaffected when no popup is showing.
- **Esc** dismisses and leaves the typed text alone. After an Esc, don't reopen at the same `[` until the cursor leaves it, so a dismissal sticks. Esc is handled by `PopoverSuggest` internally, so the suggester overrides the public `close()` instead: any close that isn't an accept records the `[` as dismissed.
- **Shift+Enter** (later): insert just the text without the URL, as an escape hatch.
- Typing `]` followed by `(`, or moving the cursor out of the bracket, closes the popup silently.

### Bracket shapes

| Buffer (`|` = cursor) | Trigger? | On accept |
|---|---|---|
| `[abc|` | Yes, query `abc` | Replace `[abc` → `[text](url)` |
| `[abc|]` (auto-paired) | Yes, query `abc` | Replace `[abc]` → `[text](url)` |
| `[ab|c]` | Yes, query `ab` | Replace the whole `[abc]` (everything up to the next `]` without another bracket in between). Whether `c` should join the query is an open question |
| `[abc]|` | No | — |
| `[abc|](…)` | No (existing link) | — |
| `[[abc|`, `![abc|`, `[^abc|`, `- [ |]` | No | — |

### After accept

- The cursor goes **after `)`**, ready to keep typing prose.
- A destination with spaces or unbalanced parentheses is written as `<url>`.
- Inside a table row, `|` in the text or URL is escaped as `\|`.
- The insertion goes through the `Editor` (`context.editor.replaceRange`), never `Vault.modify`, as the guidelines ask ("Prefer the Editor API instead of `Vault.modify`"). This gives a single undo step.

### Mobile

- `EditorSuggest` works on mobile; you tap a row. Hide the key-hint footer when `Platform.isMobile` ([Platform](https://docs.obsidian.md/Reference/TypeScript+API/Platform)).
- Keep 5 rows and full-height rows that are easy to tap. Show only the host on the secondary line; there are no tooltips.
- The plugin uses no Node/Electron APIs, so `isDesktopOnly: false`. Avoid regex lookbehind, which the [mobile development page](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development) flags for older iOS versions.
- Cold start is slowest on mobile. A cached index (see [Persistence](#persistence)) is the first post-MVP item if the cold scan turns out to hurt there.

### Link browser

A view listing every indexed link, with how many notes use it and which ones ([#3](https://github.com/brunoribeiro2k/obsidian-external-link-autocomplete/issues/3)). It's the core Tags pane (counts, sorting) crossed with Backlinks (note → the matching line), and it reuses their classes: `nav-header` buttons, a `SearchComponent`, `tree-item` rows and `search-result-file-match` lines.

- **Where:** the right sidebar or a main tab, per the "Open link browser in" setting. "Open link browser" reveals an open one, or opens it there. "Open link browser in new tab" always uses the main area. It's the same `ItemView` either way, and it can be dragged between the two.
- **Grouping:** by URL (URL → the texts used for it → notes) or by text (text → the URLs it points at → notes). A level-two row is one variant: a text and URL pair, keyed like the index. Grouping and sort order (most notes, A to Z, recently used) share one menu behind a single header button, because grouping is a less common choice than sorting.
- **Only inconsistent:** a header toggle keeping groups with more than one variant. By URL, it shows URLs written with several texts; by text, texts pointing at several URLs. That's where standardizing a vault starts.
- **Filter:** folded substring over the texts and URLs, so "jira" finds a URL whose text says Jira even when grouped by URL.
- **Notes:** a note row expands to the lines holding the link, read fresh with `cachedRead` and the scanner, since the index stores no offsets. Clicking a line opens the note with the link selected; Mod-click opens a new tab.
- **Cost:** rows render collapsed and children only on expand. 200 groups are rendered at first, with a "Show more" button. Index updates re-render at most every 500 ms, keeping what's expanded and the scroll position. Grouping, sort and the toggle are saved with the settings.

## Architecture

### Modules

```
main.ts       Plugin lifecycle, event wiring, full scan, settings load/save
text.ts       pure: fold, normUrl, stripMarkdown, URL display and insertion helpers
scanner.ts    pure: (text, skipRanges) → Occurrence[]
trigger.ts    pure: (lineText, ch) → {start, end, query} | null
ranking.ts    pure: (query, entries, options) → Suggestion[]
index.ts      pure: LinkIndex, per-file contributions + aggregates; ignore-list filter
catalog.ts    pure: (pair stats, options) → grouped, filtered, sorted rows for the link browser
suggest.ts    ExternalLinkSuggest extends EditorSuggest<Suggestion>
view.ts       LinkBrowserView extends ItemView
settings.ts   Declarative PluginSettingTab + defaults
```

Every module except `main`, `suggest`, `view` and `settings` is pure (no `obsidian` import). They hold all the logic that can go wrong, and they're unit-testable in plain Node.

### Data model

```ts
interface StoredPair { text: string; url: string; key: string; urlKey: string }

interface FileEntry {                       // Map<path, FileEntry>
	mtime: number
	pairs: StoredPair[]                     // distinct by key + urlKey: deduped per note
}

interface UrlStat {                         // one URL under one text
	paths: string[]                         // parallel arrays, one slot per note:
	texts: string[]                         // the note's spelling of the text
	urls: string[]                          // and of the URL
}

class Aggregate {                           // Map<key = fold(stripMarkdown(text)), Aggregate>
	urls: Map<string, UrlStat>              // keyed by normUrl
	summary(): { text, display, urls: { url, notes, lastUsed }[] }  // lazy, cached until the next change
}
```

- **Per-file contributions are the source of truth.** An update subtracts the file's old pairs and adds the new ones, so it costs O(links in that file), not O(vault).
- **The inserted text and URL are the most common spellings** across the notes that use the pair. `display` is that text with Markdown stripped.
- **Parallel arrays, not maps,** because almost every URL has one note, and a `Map` per URL costs several times more memory. Arrays are created at their exact size for the same reason.
- **Scanned strings are copied** (`detach` in the scanner). Engines may implement `slice` as a view into the parent string, and the index would then keep every scanned note body alive. Measured: 105 MB against 59 MB on the stress set.
- **`fold(text)`:** NFKC, lowercase, whitespace collapsed, and diacritics stripped (NFD followed by removing combining marks). This is for matching only; the original casing is kept for display and insertion.
- **`normUrl`** is used for dedupe only: lowercase the scheme and host, drop a trailing `/` on the path. The original string is what gets inserted. Queries and fragments are kept, because they're often meaningful.
- **`notes`** is the number of distinct notes containing the pair. **`lastUsed`** is the max `mtime` of those notes. That's a proxy, since no real per-link timestamp exists. The proxy is honest enough: recently touched notes are what you've been working with.
- **No prefix structure (yet).** A query is a linear pass over the folded keys with `startsWith`/`indexOf`, which measured under 5 ms for 48k keys (see [Performance](#performance-measured)). Fuzzy matching only runs when the stricter tiers leave free rows, and stops after 200 fuzzy candidates. A sorted array with binary search is the next step if real vaults need it.

### Scanner

A single pass per line, skipping ranges from the cache:

1. Skip lines inside `code` sections and `frontmatterPosition` (both are on [CachedMetadata](https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata)). Track inline backtick spans in the scanner itself. When a file has no cache yet, `fallbackSkipRanges` finds frontmatter and fenced blocks from the text (not indented code blocks).
2. Find `[`. Skip it if it's preceded by `!` or `[`, or followed by `^`.
3. Find the matching `]`, handling nested brackets and `\`-escapes.
4. Require `(` immediately after it. Read the destination as `<…>`, or as a run with balanced parentheses that stops at whitespace. Allow an optional `"title"` and a closing `)`.
5. Keep only `http:`/`https:` destinations by default.
6. Drop empty texts, texts over about 120 characters, and texts on the ignore list. A text that is itself a URL (`[https://x](https://x)`) is kept and indexed like any other link.

**Can `cache.links` replace the scanner? No (settled in M0).** The `CachedMetadata.links` doc comment lists `[alias](markdown-link)` as an example ([obsidian.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts), [LinkCache](https://docs.obsidian.md/Reference/TypeScript+API/LinkCache)), but Obsidian 1.14.4's metadata parser only turns a Markdown `link` node into a cached internal link when its URL contains no `:` (or starts with `./` or `../`). `https://…` destinations are never in `cache.links`, so the scanner is required.

**Reference-style links come almost free.** `CachedMetadata.referenceLinks` (since 1.8.7) exposes `[google]: https://google.com` definitions with `id` and `link` ([ReferenceLinkCache](https://docs.obsidian.md/Reference/TypeScript+API/ReferenceLinkCache)). Pairing the definitions with their `[text][id]` uses is a cheap post-MVP addition.

### Events and incremental updates

All event signatures below are from the official typings ([obsidian.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)) and the [MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache) and [Vault](https://docs.obsidian.md/Reference/TypeScript+API/Vault) reference pages.

| Event | Signature | Use |
|---|---|---|
| `metadataCache.on("changed")` | `(file: TFile, data: string, cache: CachedMetadata)` | Re-scan that one file from `data`, with no extra read. Docs: "Called when a file has been indexed, and its (updated) cache is now available." |
| `vault.on("rename")` | `(file, oldPath)` | Re-key `FileEntry` and re-check folder exclusion. The docs say `changed` "is not called when a file is renamed… You must hook `Vault.on('rename')`". |
| `metadataCache.on("deleted")` / `vault.on("delete")` | `(file, prevCache \| null)` / `(file)` | Subtract the contribution. |
| `vault.on("create")` | `(file)` | Ignored. Its docs say it also fires "for each existing file" on vault load, so register only inside `workspace.onLayoutReady()`. `changed` covers new content anyway. |
| `vault.on("modify")` | `(file)` | **Not used.** It carries no content and no section map; `changed` supersedes it for Markdown. |

Strategy:

1. **`onload`:** load settings and register the suggester. Nothing else is heavy, which keeps load time low.
2. **`onLayoutReady`:** register the events, then run a full scan over `vault.getMarkdownFiles()` using `cachedRead` plus `getFileCache`. The scan yields (`await sleep(0)`) whenever a slice has run for 30 ms. Until it finishes, suggestions come from whatever has been indexed so far. A rebuild (command, button, or an index-affecting settings change, debounced by 1 s) abandons a scan in progress.
3. **On `changed`:** a per-path debounce of 300 ms, then re-scan and patch the aggregates.
4. **Folders:** a folder rename re-keys every file under it; a folder delete drops every indexed path under it. Moving a file out of an excluded folder indexes it.
5. **Active-note self-boost:** a link typed seconds ago shouldn't outrank everything. Count it, but cap the recency of the note being edited. This is an open question; for now the note being edited counts like any other.

### Persistence

| Option | Pros | Cons |
|---|---|---|
| In-memory rebuild each launch | Simple, never stale, no data file growth | Reads every note at each start |
| Cache in `saveData` (`path → {mtime, size, pairs}`) | Warm start in well under a second; reconcile by `mtime`/`size` | Invalidation logic; data file grows with the vault |

**Decision:** in-memory for the MVP. Measure on the stress vault and on a phone. If the cold scan is over about 3 s on desktop or noticeably slow on mobile, add the cache. Store it versioned (`schemaVersion`), keep only per-file pairs (never aggregates), and discard it on a version mismatch.

### Performance (measured)

Measured under Node 22 on a desktop (Linux) on a synthetic set: 10k notes of 40 lines with 5 external links each, 48k distinct texts, each with its own URL. That's a worst case for the index, since real links repeat. Not yet measured inside Obsidian or on a phone.

| Metric | Target | Measured |
|---|---|---|
| `findTrigger`, per keystroke | < 0.2 ms | 0.0002 ms |
| Ranking a query (`getSuggestions`) | < 5 ms, synchronous | 1.4–3 ms for 2+ characters; 4.6 ms for a 1-character query |
| Cold full scan (scanner + index, no I/O) | < 3 s, no long task > 50 ms | 0.25–0.3 s of CPU, sliced at 30 ms |
| Incremental update for one file | < 10 ms | 0.03 ms |
| Index memory | < 20 MB for 50k distinct pairs | 40 MB for 48k distinct texts and URLs; note bodies aren't retained |

Memory misses the target on this worst case. It's acceptable on desktop. If it hurts on mobile, the next steps are interning strings shared across pairs and collapsing the per-text `Map` for texts that have a single URL.

**`onTrigger` also ranks.** Obsidian stops at the first suggester whose `onTrigger` returns non-null, even if that suggester then has nothing to show (see [Conflicts](#conflicts-with--and-other-suggesters)). So `onTrigger` runs the query, returns `null` when there are no rows, and hands the rows to `getSuggestions`. That keeps `[` free for other plugins whenever this one has nothing to offer.

## Ranking

1. **Tier:** exact folded match, then prefix, then word-start prefix (`board` matches "Jira board"), then fuzzy (subsequence). A row from a higher tier always beats one from a lower tier.
2. **Within a tier:** score = `w_f · log(1 + notes) + w_r · recencyDecay(lastUsed)`, where recency decays with a half-life of 90 days. Balanced uses `w_f = w_r = 1`.
	- **Balanced** (default): both weights apply.
	- **Frequency:** `w_r = 0`.
	- **Recency:** `w_f = 0`.
3. **Ties:** shorter text first, then alphabetical, so ordering stays stable while you type.
4. **Multiple URLs for one text:** one row per URL, with the URLs ordered by the same score. A text's rows stay together, and the text is ranked by its best URL.

## Edge cases

| Case | Behavior |
|---|---|
| Same text, different URLs | One row per URL, told apart on the secondary line. The setting can collapse them to "most recent" or "most used". |
| URL changed over time | Both are kept. Recency surfaces the new one. (M2: the older row gets a muted "older" aux tag when a newer URL exists for the same text.) |
| Autolinks `<https://…>` | Not indexed (no text to key on). |
| Bare URLs | Not indexed in the MVP. Later, behind an off-by-default setting: key them on host plus last path segment (e.g. `github.com/obsidianmd`), insert as `[<that key>](url)`, and show them below text links. |
| Reference-style `[text][id]` | MVP: not indexed. Later: via `referenceLinks`. |
| Tables, callouts, lists, blockquotes | Indexed normally; the scanner skips the line prefixes `>`, `-`, `1.`, `|`. Inserting inside a table escapes `|`. Triggering inside a callout works the same as in a normal line. |
| Markdown inside the text (`[**x**](…)`) | Keep the raw text for insertion, and match and display a stripped version. |
| Case | Match case-insensitively. Insert the stored, most frequent casing; whether to use the typed casing instead is an open question. |
| Accents, Unicode | Folded for matching, so `[cafe` finds "Café". |
| Minimum trigger length | Default 2 characters after `[`. |
| Excluded folders | Skipped at index time. A settings change triggers a re-index. |
| Ignore list | Texts (`here`, `link`, `this`, `source`, `click here`) and domain patterns. Applied at index time. |
| Text is the URL (`[https://x](https://x)`) | Indexed like any other aliased link; the URL text is matched and inserted as is. |
| Empty text, images, non-http schemes | Skipped. |
| Huge single note (logs, exports) | Pairs are deduped per note, so it counts once per pair. (Later, if needed: a setting to skip files over N KB.) |

## Settings

| Setting | Default | Notes |
|---|---|---|
| Minimum characters | 2 | 1–5 |
| Ranking | Balanced | Balanced / Most used / Most recent |
| When a text has several links | Show all | Show all / Only most recent / Only most used |
| Accept with tab | On | Enter always accepts |
| Show note count | Off | Aux column |
| Ignored link texts | here, link, this, source, click here | One per line, folded like queries |
| Ignored domains | — | One per line, glob-like (`*.internal.example.com`); `*` matches any run of characters |
| Open link browser in | Right sidebar | Right sidebar / New tab; see [Link browser](#link-browser) |
| Rebuild index | action row + command | No default hotkey |
| Excluded folders | — | A list with a folder picker per row; paths go through `normalizePath()` |
| Index bare URLs | — | Not in the MVP (see [Edge cases](#edge-cases)) |

The tab uses the declarative settings API (`getSettingDefinitions`, Obsidian 1.13+), so every setting appears in Obsidian's settings search. That's why `minAppVersion` is 1.13.0. Excluded folders is the only list with a heading; the guideline below allows it since it's a separate section.

UI follows the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines): "Use Sentence case in UI", "Only use headings under settings if you have more than one section", "Avoid 'settings' in settings headings", `setHeading()` instead of HTML headings, and "Avoid setting a default hotkey for commands".

## Conflicts with `[[` and other suggesters

**What is documented:**

- `Plugin.registerEditorSuggest` registers "an EditorSuggest which can provide live suggestions while the user is typing" ([reference](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerEditorSuggest)). Registration through the plugin means it's torn down on unload.
- `onTrigger(cursor, editor, file: TFile | null)` returns `EditorSuggestTriggerInfo | null`, with `null` meaning "not supposed to be triggered". It runs on every keypress ([EditorSuggest](https://docs.obsidian.md/Reference/TypeScript+API/EditorSuggest); the signature with `file: TFile | null` dates from 1.1.13 in the typings).
- There is **no** documented priority or sort order for `EditorSuggest`s.

**What is not documented, but observed (M0, Obsidian 1.14.4 `app.js`):**

- **Arbitration: an ordered list, first non-null `onTrigger` wins.** The private manager (`app.workspace.editorSuggest`) creates four core suggesters in its constructor, and `registerEditorSuggest` appends plugins after them (`suggests.push`). On each keypress it walks the list and stops at the first suggester whose `trigger()` returns true, which happens whenever `onTrigger` returns non-null, **even if `getSuggestions` then returns nothing** (an empty list just closes the popup). This matches the [forum thread](https://forum.obsidian.md/t/help-with-hot-reload-plugin-for-editorsuggest/94678) report. It's still not a contract.
- **Core's four:** the link suggester (`[[`, active while the last `[[` on the line comes after the last `]`), tags (`#`), footnotes (`[^`, via `/(?:^|[^\[])(\[\^)([^\]]*)$/`), and one that triggers on `=`. They always run before any plugin. None of them triggers on a plain `[`, so there's no overlap with this plugin.
- **Consequence:** this plugin's `onTrigger` returns non-null only when it has rows to show, so it never blocks a later plugin on a `[` it can't use.

**Defensive design:**

1. Never compete for the same trigger. Refuse `[[`, `![`, `[^`, and task brackets, so there's no shared input with core's link suggester, footnote plugins, or task plugins.
2. `onTrigger` is cheap, pure and wrapped in `try/catch → null`. It never throws into another plugin's turn.
3. Don't touch private internals (`app.workspace.editorSuggest.suggests`) to reorder priority. If another plugin wins on `[`, document the conflict in the README rather than patch it.
4. Test alongside the planned Inline Note Property References plugin, whose `[[note#=` suggester has the same contention shape, and alongside Various Complements, Templater and Inline Link Suggestions.
5. Add a "pause suggestions" command so a conflict can be worked around without disabling the plugin.

## Privacy

- **Fully local.** The plugin reads vault files through the Vault API and the metadata cache. It makes **no network requests**: no telemetry, no update pings, no favicons.
- The index lives in memory (and, post-MVP, in the plugin's own `data.json`). The README states this.
- **Decision on page-title fetching: not in the MVP, never automatic, never on by default.** Fetching titles for vault URLs would tell third parties which sites you link to, and could hit internal URLs from a personal machine. If it ever ships, it's an explicit per-link command (for example, "Fetch title for link under cursor") with a disclosure in settings. It's never a background crawl, and it must be disclosed in the README as the community guidelines expect for network use.

## Testing

### Unit tests (`node --test` + `tsx`)

- **Scanner:** nested brackets, `\]` escapes, `https://en.wikipedia.org/wiki/Foo_(bar)`, `<url with spaces>`, `[t](url "title")`, images, wikilinks, footnotes, inline code, multiple links per line, CRLF.
- **Trigger:** every row of the bracket-shapes table, plus table rows, callouts, nested lists, and the cursor at line start and end.
- **Ranking:** tier ordering, all three modes, distinct-note counting, tie stability, a fold/diacritic case, multi-URL ordering.
- **Index:** add, modify, rename and delete sequences leave the aggregates equal to a full rebuild (a property-style test that compares incremental results against a full scan).

### Manual test vault (generated into the gitignored `test-vault/`)

- `npm run setup-vault` copies the notes in `test/fixtures/vault/` into `test-vault/`, deploys the build, and enables the plugin. The fixtures cover each edge-case row and an `Excluded/` folder; the vault's plugin settings are seeded to exclude it. `-- --stress` also generates a `stress/` folder with 10k notes.
- `Checklist.md` in the vault lists the expected behavior for each case.
- A matrix to run before each release: auto-pair on and off, Live Preview and Source mode, light and dark theme plus one popular community theme, desktop and phone, and with Inline Link Suggestions and Various Complements enabled.

### Community-plugin review requirements

From [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) and the [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines):

- The repo root has `README.md`, `LICENSE` and `manifest.json`.
- The GitHub release has `main.js`, `manifest.json` and an optional `styles.css` as assets. The `version` is semver `x.y.z` and the tag matches it.
- The `id` is unique and "can't contain `obsidian`".
- Submission happens on community.obsidian.md with a linked GitHub account. "After you submit, your plugin is reviewed automatically and the directory shows guidance for anything that needs to be corrected."
- Guidelines that apply here:
	- "Avoid unnecessary logging… the developer console should only show error messages".
	- Use `this.app`, not the global `app`.
	- No `innerHTML`/`outerHTML`/`insertAdjacentHTML`; use `createEl`/`createDiv`/`createSpan`.
	- Use the Editor API rather than `Vault.modify` for the active file.
	- Use `normalizePath()` for user paths.
	- Don't detach leaves in `onunload`.

**"No `any`" and "no `console.log`"** aren't worded that way in the docs. They're enforced by tooling. The official [obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin) checks plugins against the guidelines, with rules such as `ui/sentence-case`, `settings-tab/no-manual-html-headings`, `detach-leaves`, `regex-lookbehind` and `no-forbidden-elements`. Adopt it from the first commit, together with `strict` TypeScript, `@typescript-eslint/no-explicit-any: error` and `no-console: ["error", { allow: ["error"] }]`. Run it in CI. One unavoidable `any` exists: `registerEditorSuggest(editorSuggest: EditorSuggest<any>)` in the typings. Passing a typed `EditorSuggest<Suggestion>` satisfies it without writing `any` ourselves.

## Milestones

### M0: spike — done

- Answered from Obsidian 1.14.4's bundled `app.js` instead of a throwaway build: suggester precedence (see [Conflicts](#conflicts-with--and-other-suggesters)) and `cache.links` (see [Scanner](#scanner)).
- Still to confirm in the test vault: the core suggestion CSS classes render correctly in the popup, and the behavior alongside popular suggester plugins.

### M1: MVP — implemented, pending manual verification

- Scanner, in-memory index, incremental updates, trigger, ranking, native popup, accept with cursor handling, Tab/Enter/Esc.
- Settings: min chars, ranking mode, multi-URL behavior, Tab accept, note count, excluded folders, ignore lists, rebuild.
- Unit tests, the test vault and its checklist, ESLint + CI, and a README with the privacy statement.
- Left: walk the test-vault checklist in Obsidian (desktop and phone), then the first real release and submission.

### M2: polish

- [Link browser](#link-browser) (#3).
- Persisted cache (if M1 measurements call for it), reference-style links, "older URL" hint, Shift+Enter text-only insert, pause command.

### Later

- Per-domain grouping and filtering (`[@github`).
- **Collect link from clipboard:** with text selected and a URL on the clipboard, a command wraps the selection as `[selection](url)`, and the pair becomes immediately suggestible.
- Bare-URL indexing, out of experimental.
- Opt-in, per-link title fetching (see [Privacy](#privacy)).

## Open questions

1. ~~Does `CachedMetadata.links` include `http(s)` Markdown links?~~ No (M0, see [Scanner](#scanner)).
2. ~~How does Obsidian arbitrate between several `EditorSuggest`s, and is core's `[[` one of them?~~ Ordered list, core first, first non-null `onTrigger` wins (M0, see [Conflicts](#conflicts-with--and-other-suggesters)).
3. Insert the stored casing or the casing the user typed?
4. With the cursor in `[ab|c]`, should `c` be part of the query?
5. How much should links in the note being edited count?
6. Is Tab-to-accept safe on every mobile keyboard and with IME composition?
7. For bare URLs, is host plus last path segment a text people would actually type?
8. Should the "older URL" hint be inferred automatically, or only from an explicit "retire this URL" action?

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Suggester precedence is undocumented and could change | Popup stops appearing, or another plugin's wins | Non-overlapping triggers; no private internals; regression check on each Obsidian release |
| Core suggestion CSS classes change | Popup looks off | Thin CSS layer on theme variables; visual check per release |
| Auto-pair and IME behavior vary by setting and platform | Misfires or missed triggers | Handle both bracket shapes; test matrix includes auto-pair off and a CJK IME |
| Cold scan is slow on mobile or huge vaults | Suggestions arrive late | Chunked scan, partial results, persisted cache in M2 |
| Stale URLs get suggested | Wrong link inserted | Recency ranking, URL always visible, "older" hint |
| Popups while writing prose with brackets | Annoyance, so the plugin gets disabled | Min length, ignore list, Esc sticks, pause command |
| Review rejection | Delayed listing | Official ESLint plugin in CI from day one |
| Suggester precedence observed in 1.14.4 changes | Popup stops appearing | Only claim `[` with rows to show; re-check `app.js` on major releases |

## Sources

- EditorSuggest: https://docs.obsidian.md/Reference/TypeScript+API/EditorSuggest
- PopoverSuggest: https://docs.obsidian.md/Reference/TypeScript+API/PopoverSuggest
- Plugin.registerEditorSuggest: https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerEditorSuggest
- MetadataCache: https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache
- CachedMetadata: https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata
- LinkCache: https://docs.obsidian.md/Reference/TypeScript+API/LinkCache
- ReferenceLinkCache: https://docs.obsidian.md/Reference/TypeScript+API/ReferenceLinkCache
- Vault: https://docs.obsidian.md/Reference/TypeScript+API/Vault
- Platform: https://docs.obsidian.md/Reference/TypeScript+API/Platform
- Official typings (event signatures, `@since` tags, doc comments quoted above): https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Submit your plugin: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- Mobile development: https://docs.obsidian.md/Plugins/Getting+started/Mobile+development
- Official ESLint plugin: https://github.com/obsidianmd/eslint-plugin
- Forum, EditorSuggest ordering: https://forum.obsidian.md/t/help-with-hot-reload-plugin-for-editorsuggest/94678
