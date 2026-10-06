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

## Platforms

- [ ] Live Preview and Source mode.
- [ ] Mobile: tap a row to insert; no key-hint footer; secondary line shows only the host.
- [ ] With `npm run setup-vault -- --stress`: no typing lag, and the startup scan doesn't freeze the UI.
