# CLAUDE.md

Guidance for working in this repository.

## What this is

**External Link Autocomplete** is an Obsidian plugin that suggests external links already used in the vault while the user types a Markdown link. Typing `[abc` offers `abcdef` when `[abcdef](https://example.com)` exists somewhere in the vault; accepting inserts the whole `[abcdef](https://example.com)`. It is an `EditorSuggest` over an incrementally maintained, fully local index.

Goal: ship it to the **Obsidian community plugins** list.

## The design doc is the spec

**[`docs/design.md`](docs/design.md) is the source of truth** for behavior, architecture, settings, edge cases, ranking and milestones. Read it before implementing anything, and keep it current: a change in behavior or scope updates the doc in the same change. When the doc and the code disagree, raise it rather than silently picking one.

It started as a note in the author's Obsidian vault (`90-meta/obsidian/Idea - Plugin - Inline External Link Autocomplete.md` under `~/projects/brunoribeiro2k/obsidian`). From here on the repo copy is canonical.

## Current status

M0 is done: both questions were answered by reading Obsidian 1.14.4's bundled `app.js` (recorded in `docs/design.md`). Suggesters run in a list with core first, and the first non-null `onTrigger` wins. `http(s)` links aren't in `cache.links`, so the scanner is required.

M1 (the MVP) is implemented and unit-tested. What's left is walking `Checklist.md` in the generated test vault (desktop and phone), then the first real release and community submission.

`minAppVersion` is 1.13.0, for the declarative settings API. Supporting older Obsidian versions isn't a goal.

## Decisions already made

Don't re-litigate these without being asked:

- Links whose text is the URL (`[https://x](https://x)`) are indexed like any other aliased link.
- Autolinks `<https://…>` aren't indexed. Bare URLs are behind an off-by-default setting. A URL-matching second tier for unaliased URLs has been proposed but isn't in the design yet.
- No network requests, ever, in the MVP. Page-title fetching would only ever be an opt-in, per-link command.
- An in-memory index for the MVP. A persisted cache only if measurements call for it.
- Plugin id `external-link-autocomplete`, name "External Link Autocomplete". `isDesktopOnly: false`, so mobile is supported.

## Layout

- `src/main.ts`: plugin entry (bundled to `main.js`), with `suggest`, `view`, `edit-modal`, `settings` and the pure modules `text`, `scanner`, `trigger`, `ranking`, `index`, `catalog` and `rewrite` next to it (see the design doc's module table). The pure modules must stay **pure**: no `obsidian` import, so they're unit-testable under Node.
- `test/*.test.ts`: `node --test` unit tests, with TypeScript loaded through `tsx` (the local Node build has no native TypeScript support). Import sources with explicit `.ts` extensions (`../src/scanner.ts`).
- `test/fixtures/vault/`: version-controlled sample notes for manual verification, including `Checklist.md` and an `Excluded/` folder. They're copied into the gitignored `test-vault/` by `npm run setup-vault`, which also seeds the plugin's settings to exclude that folder.
- `docs/design.md`: the spec.
- `styles.css`: theme variables only.
- `manifest.json`, `versions.json`, `version-bump.mjs`, `.npmrc`, `scripts/`, `.github/workflows/`: release tooling, copied from the sibling `obsidian-link-tooltip` repo and working the same way.

## Commands

The `Makefile` wraps these for the user (`make` lists them: `make check`, `make vault`, `make open`, `make deploy VAULT=…`, `make release BUMP=…`). Keep it in sync when adding an npm script.

- `npm run dev`: esbuild watch.
- `npm run build`: typecheck (`tsc`), lint (`eslint`), then the production bundle. **This is the gate**: run it before calling a change done.
- `npm test`: unit tests.
- `npm run setup-vault`: build, then (re)generate `test-vault/` from the fixtures with the plugin enabled. Open it in Obsidian to verify editor behavior, which unit tests can't cover.
- `npm run deploy -- --vault "/path/to/Vault"`: build and copy into a real vault.
- `npm run release -- <patch|minor|major>`: bump the version on a `release/<version>` branch and open a PR. Run it from an up-to-date `main`; it refuses anywhere else. Merging it makes `release.yml` tag the commit (no `v` prefix) and draft the GitHub release.

## Conventions / hard rules

These follow the Obsidian community-plugin review. The official `eslint-plugin-obsidianmd` recommended config enforces most of them, so keep `npm run build` green.

- **No `any`**, and no `console.*` except `console.error` in `src/`. Lint enforces both.
- **Theme-aware styling.** Reuse core's suggestion classes, and use CSS variables, never hardcoded colors. The popup must look native (see the doc's "Popup layout" and its list of what looks dated).
- **Sentence case** in all UI text. No settings heading unless there are several sections, and never the word "settings" in one. No default hotkeys.
- **No `innerHTML`.** Build DOM with `createEl` / `createDiv` / `createSpan` / `setText`.
- **`this.app`**, never the global `app`. Write to open notes through the `Editor` API, and to other notes (vault-wide link edits) through `Vault.process`; never `Vault.modify`. Run user paths through `normalizePath()`.
- **Clean teardown.** Register everything through `registerEditorSuggest` / `registerEvent` / `register*` so unload cleans up.
- **No private internals.** Don't touch `app.workspace.editorSuggest` or other undocumented objects to win suggester precedence.
- **Mobile-safe.** No Node or Electron APIs in `src/`, and no regex lookbehind.
- **`onTrigger` is hot.** It runs on every keypress, so return `null` early, never throw, and do no I/O.
- Keep the `manifest.json` description short, ending with a period, without "This plugin" or the word "Obsidian".
- Commit messages and PR titles follow Conventional Commits (CI lints PR titles).
