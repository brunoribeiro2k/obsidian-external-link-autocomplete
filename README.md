# External Link Autocomplete

An Obsidian plugin that suggests external links you've already used, as you type a Markdown link.

Type `[abc` in the editor and, if you've written `[abcdef](https://example.com)` anywhere in your vault, a suggestion offers `abcdef`. Accepting it inserts the full `[abcdef](https://example.com)`. You don't have to go hunting for URLs you've used before.

> **Status:** design stage. Nothing works yet. See [`docs/design.md`](docs/design.md).

## Privacy

Everything stays local. The plugin reads your notes to build an in-memory index of the links you've used. It makes no network requests: no telemetry, no favicons, no page-title fetching.

## Development

```sh
npm install
npm run build        # typecheck + lint + bundle
npm test             # unit tests
npm run setup-vault  # build, then open test-vault/ in Obsidian to try it
```

## License

MIT
