# Checklist

Manual checks for what unit tests can't cover. Type in a scratch note; each line names what to type (`|` is the cursor) and what should happen.

## Popup

- [ ] `[ob|` with auto-pair on (buffer `[ob|]`): popup lists "Obsidian developer docs" and "Obsidian API typings".
- [ ] Rows look native: title with the match highlighted, `host › path` underneath, no wrapping, theme colors in light and dark.
- [ ] Hovering a row on desktop shows the full URL.
- [ ] `[docs|`: two "Docs" rows, told apart by host.
- [ ] `[release|`: two "Release notes" rows (v1 and v2), not three.
- [ ] `[board|`: "Jira board" (word-start match).
- [ ] `[cafe|`: "Café Crème".
- [ ] `[bold|`: "Bold reference" is shown without asterisks.

## Accepting

- [ ] Enter inserts `[Text](url)`, consuming the auto-paired `]`, with the cursor after `)`.
- [ ] Tab does the same (and doesn't indent the list item).
- [ ] Clicking a row inserts it.
- [ ] One undo (Ctrl/Cmd+Z) restores the typed `[ob]`.
- [ ] `[spaced d|` inserts `[Spaced destination](<https://example.com/with space>)`.
- [ ] In a table cell, `|` in the inserted text or URL is escaped as `\|`.
- [ ] With auto-pair off, `[ob|` (no `]`) also works.

## No popup

- [ ] `[o|` (below the 2-character minimum).
- [ ] `[[ob|`: core's note suggester opens instead.
- [ ] `![ob|`, `[^ob|`, `- [ |]`, `` `[ob|` ``, inside a fenced code block, on a property's name or comment in Source mode.
- [ ] `[ob]|` and `[ob|](https://…)`.
- [ ] `[private|`: nothing from `Excluded/`.
- [ ] `[here|`, `[fenced|`, `[indented|`, `[in a comment|`, `[in a block|`: never indexed.
- [ ] Esc closes the popup, and it stays closed while typing more in the same bracket; a new `[` opens it again.

## Index updates

- [ ] Add `[Fresh link](https://example.com/fresh)` to a note; within a second `[fresh|` suggests it.
- [ ] Delete that line; `[fresh|` no longer suggests it.
- [ ] Rename or move a note with links; its links are still suggested.
- [ ] Move `Excluded/Private links.md` out of `Excluded/`; `[private|` now suggests it.
- [ ] Settings: change "Ignored link texts" or "Excluded folders"; suggestions follow within a couple of seconds.
- [ ] "Rebuild link index" from the command palette works, and has no default hotkey.

## Link browser

- [ ] "Open link browser" opens "External links" in the right sidebar; running it again reveals the same view.
- [ ] The command palette has only one link browser command, and the settings have no "Open link browser in".
- [ ] Drag the browser from the sidebar into a tab and close it; "Open link browser" reopens it as a tab. Drag it back to a sidebar (right or left) and close it; it reopens there. The placement survives restarting Obsidian.
- [ ] Rows look native: collapse arrows, note counts on the right, indentation, theme colors in light and dark.
- [ ] By URL: `docs.obsidian.md › Home` expands to "Docs" and "Obsidian developer docs", each with its notes.
- [ ] The sort button's menu switches to "Group by text": "Docs" expands to two URLs. The choice survives closing and reopening the view.
- [ ] "Only inconsistent" (the split icon, highlighted when on) leaves only those two groups, depending on the grouping.
- [ ] Filtering by `jira` keeps only the Jira link, in both groupings.
- [ ] A note row shows the line with the link highlighted; clicking it opens the note with the link selected. Mod-click opens it in a new tab.
- [ ] Add a link to a note; it appears in the browser within a second or two, without collapsing what's expanded.
- [ ] Mobile: the view opens in the right drawer and lines are tappable.

## Edit link across vault

Use `Link variants.md`. "Undo last link edit" (below) resets it, or run `make vault` again.

- [ ] With the cursor in `[jira](…)`, "Edit link across vault" shows in the command palette and the right-click menu; with the cursor in plain text or in the code block, it doesn't.
- [ ] Right-clicking the rendered "Sprint board" link in Live Preview offers it too.
- [ ] The modal is prefilled with `jira` and the URL, and says "Nothing to change." with the button disabled.
- [ ] Typing `Jira board` lists the `[jira](…)` line ("1 link in 1 note"), and the button reads "Update 1 link" in the destructive style.
- [ ] "Also update other texts for this URL" lists "Jira board", "Sprint board" and "JIRA BOARD" with counts. Turning it on adds the "Sprint board" and "JIRA BOARD" lines; links already written `[Jira board](…)` exactly aren't listed; `[here](…)` never is.
- [ ] Clearing the text, or typing `a]b` or a non-http URL, disables the button with an explanation.
- [ ] Applying shows "Updated N links in M notes."; the title `"Team board"` survives, the trailing-slash URL is now written as typed, the table cell is intact, and the code block is untouched.
- [ ] With `Link variants.md` open and unsaved typing in it, applying keeps that typing, and Ctrl+Z in that note undoes the edit there.
- [ ] Changing only the URL rewrites the destinations and keeps the texts.
- [ ] In the link browser, right-clicking the Jira URL group (grouped by URL) offers "Edit link across vault", opening the modal on its most used text; right-clicking the "Sprint board" row under it opens the modal on `Sprint board`.
- [ ] After applying, the browser updates on its own, and the group no longer shows under "Only inconsistent" once every text is unified.
- [ ] Mobile: long-pressing a row in the browser opens the same menu.
- [ ] "Undo last link edit" is missing from the palette until an edit is applied. Running it shows "Reverted N links in M notes." and every note is back as it was, title and table included; the command then disappears again.
- [ ] Apply an edit, change one of the edited links by hand in a closed note, then undo: that link stays as you wrote it, and the notice says 1 link was left as is.
- [ ] Apply an edit, rename one of the edited notes, then undo: its links are reverted too.

## External links in a note

- [ ] With "Backlink in document" on (core Backlinks settings), open `Link variants.md` in Live Preview: "External links" is a third pane after "Linked mentions" and "Unlinked mentions", looking like them. One row per URL, in order of first use. A URL written with several texts lists them all, and "×N" shows when it's used more than once.
- [ ] The row's flair is the number of notes in the vault using the URL; hovering it says so.
- [ ] Clicking a row selects the first link to that URL and scrolls to it; clicking the `host › path` part opens the URL in the browser instead.
- [ ] Right-clicking a row offers "Edit link across vault".
- [ ] With backlinks in document off, the section stands alone right after the last line, with a separator; toggling backlinks moves it between the two places.
- [ ] Add a link at the end of the note; the section follows within a second, without saving, and stays below the new text. Links in code blocks aren't listed; links in properties are, first.
- [ ] Clicking the header collapses the section in every open note; it stays collapsed after reopening the note and restarting.
- [ ] Source mode and reading view show it too (in reading view without backlinks, at the top of the footer), and clicking a row scrolls there. Switching modes moves it along.
- [ ] A note without external links has no section. Canvas cards and embedded notes never get one.
- [ ] Settings → "Show external links in notes" off removes every section at once; on brings them back.

## Properties

Use `Properties.md`.

- [ ] `[project plan|`, `[it's|`, `[plain prop|`, `[related|`, `[flow item|` and `[in frontmatter|` suggest the links in properties, with "It's single-quoted" shown with one quote.
- [ ] Properties view, text property: add `test` with value `[project|`; the popup opens under the input, looking like the editor's. Enter (or Tab, or a click) writes `[📃 GDocs - Project plan](https://…)` into the input with the caret after it, without committing; Enter again commits, and Source mode shows `test: "[📃 GDocs - Project plan](https://…)"`.
- [ ] Properties view, list property: in `related`, type `[flow|` in the new-item input and accept; Enter adds the pill.
- [ ] Properties view: Esc closes the popup and keeps the typed text, which stays uncommitted; typing on in the same bracket doesn't reopen it.
- [ ] Source mode: `key: "[proj|"` inserts the link inside the quotes, `key: [proj|` writes `key: "[📃 GDocs - Project plan](https://…)"`, and `key: '[it|'` writes `It''s` with the quote doubled. The YAML stays valid (the Properties view shows the values).
- [ ] Source mode: with the cursor on the `google-doc` link, "Edit link across vault" is offered. Renaming it to `GDocs: "Plan"` gives `google-doc: "[GDocs: \"Plan\"](https://…)"`, and the rest of the frontmatter is untouched, comment and block included.
- [ ] Renaming the `plain` link to `Plain: property` turns its value into `plain: "see [Plain: property](https://example.com/plain) here"`.
- [ ] Renaming `jira` across the vault (from `Link variants.md`) also updates `related` here; undo puts it back.
- [ ] The link browser lists the property links, with the YAML line as context; `Properties.md`'s external links section lists them first.
- [ ] Settings → "Include properties" off: none of the above is suggested, listed or edited, and neither the Properties view nor Source mode frontmatter gets a popup.

## Platforms

- [ ] Live Preview and Source mode.
- [ ] Mobile: tap a row to insert; no key-hint footer; secondary line shows only the host.
- [ ] With `npm run setup-vault -- --stress`: no typing lag, and the startup scan doesn't freeze the UI.
