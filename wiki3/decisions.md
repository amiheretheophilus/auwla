# Decisions

Accepted user direction, dated, with the user's words. Open questions are at the end.

| ID | Date | Decision | Where |
| --- | --- | --- | --- |
| DOC-02 | 2026-11-16 | Documents are a new language with their own wiki and spec (this folder), not part of wiki2. User: "this is also it new language stuff so we need to create a wiki3 then have it spec and stuff". | [README](README.md) |
| DOC-01 | 2026-11-16 | The extension is `.auwla.md`. Plain `.md` or `.mdx` would do for the compiler alone; the distinct extension is for editor support, scoped to documents only. User: "we dont need a.auwla.md it just needs to be a.md or a.mdx unless u want to bring editor support in those files too if that is ur intention then i think yeah", then "i think .auwla.md is okay". | [architecture](architecture.md) |
| DOC-00 | 2026-11-16 | Build our own architecture rather than the root `mdx-research.md` draft. User: "redo analysis and bring ur own architecture i think it will help than to use this draft". The proposal keeps MDX's authoring model with Auwla's syntax and static output; the user's next decisions built on it. | [architecture](architecture.md) |

## Open

1. **Dependencies** (needed for slice 2): `mdast-util-from-markdown`,
   `micromark-extension-gfm`, `mdast-util-gfm` and what they bring. Later, Shiki for
   build-time code highlighting (slice 5).
2. **Braces in prose.** Recommended: `{expr}` inserts a value and `\{` writes a brace, as
   in `.auwla` quoted text and MDX. Alternative: VitePress's `{{ expr }}`, fewer escapes
   but a second interpolation syntax.
3. **Metadata.** Recommended: `export const meta = { … }`, checked by TypeScript. Alternative:
   YAML front matter (another dependency).
4. **Comments.** Proposed: `{/* … */}`, as MDX. HTML comments are not available, since HTML
   is disabled.

The spec drafts these with the recommended answers, marked provisional.
