---
source: "[In frontmatter](https://example.com/frontmatter)"
---
# Edge cases

Each link here should be suggestible unless the line says otherwise.

## Text shapes

- [Jira board](https://example.atlassian.net/jira/software/projects/DATA/boards/42) — word-start match: `[board`
- [**Bold** reference](https://example.com/bold) — shown as "Bold reference", inserted with the `**`
- [Café Crème](https://example.com/cafe) — `[cafe` finds it
- [a [nested] text](https://example.com/nested) and [two per line](https://example.com/two) on one line
- [Escaped \] bracket](https://example.com/escaped)
- [Spaced destination](<https://example.com/with space>) — re-inserted as `<…>`

## Same text, several URLs

- [Release notes](https://example.com/releases/v1)
- [Release notes](https://example.com/releases/v2)
- [release NOTES](https://example.com/releases/v2/) — same URL as above once normalized

## Containers

| Name | Link |
| --- | --- |
| Table | [Table link](https://example.com/table) |

> [!note]
> [Callout link](https://example.com/callout)

> [Quoted link](https://example.com/quote)

## Ignored by default

- [here](https://example.com/ignored-text) — on the default ignore list
- [click here](https://example.com/ignored-text-2)

```md
[Fenced](https://example.com/fenced) — inside a code block, never indexed
```

    [Indented code](https://example.com/indented) — indented code block, never indexed
