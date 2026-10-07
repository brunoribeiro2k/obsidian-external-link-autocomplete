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
- [ ] `![ob|`, `[^ob|`, `- [ |]`, `` `[ob|` ``, inside a fenced code block, inside frontmatter.
- [ ] `[ob]|` and `[ob|](https://…)`.
- [ ] `[private|`: nothing from `Excluded/`.
- [ ] `[here|`, `[fenced|`, `[indented|`, `[in frontmatter|`: never indexed.
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
- [ ] "Open link browser in new tab" opens it as a main tab; Settings → "Open link browser in" → New tab makes the first command do the same.
- [ ] Rows look native: collapse arrows, note counts on the right, indentation, theme colors in light and dark.
- [ ] By URL: `docs.obsidian.md › Home` expands to "Docs" and "Obsidian developer docs", each with its notes.
- [ ] The sort button's menu switches to "Group by text": "Docs" expands to two URLs. The choice survives closing and reopening the view.
- [ ] "Only inconsistent" (the split icon, highlighted when on) leaves only those two groups, depending on the grouping.
- [ ] Filtering by `jira` keeps only the Jira link, in both groupings.
- [ ] A note row shows the line with the link highlighted; clicking it opens the note with the link selected. Mod-click opens it in a new tab.
- [ ] Add a link to a note; it appears in the browser within a second or two, without collapsing what's expanded.
- [ ] Mobile: the view opens in the right drawer and lines are tappable.

## Edit link across vault

Use `Link variants.md`. Commit or copy `test-vault/` first if you want to repeat these.

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

## Platforms

- [ ] Live Preview and Source mode.
- [ ] Mobile: tap a row to insert; no key-hint footer; secondary line shows only the host.
- [ ] With `npm run setup-vault -- --stress`: no typing lag, and the startup scan doesn't freeze the UI.
