# Plan

Ordered, not frozen: reorder or split a slice when evidence says so, and note why here.

| Slice | Outcome | Needs |
| --- | --- | --- |
| 0 | **Done** (2026-11-16). compiler-next folds constant string children into templates, so `.auwla` quoted text ships in templates ([architecture](architecture.md#the-compiler-next-change-this-needs-and-auwla-needs-now), [core](../wiki/compiler/core.md#plan--coreplan)) | nothing |
| 1 | Spec settled: the open decisions answered, the provisional rules confirmed or revised, fixtures pinned | the user's answers |
| 2 | Pre-scan, Markdown and emit for prose: headings, paragraphs, lists, links, images, tables, code, escapes; static output; exact mappings | approval of the micromark dependencies |
| 3 | ESM blocks, block and inline elements with Markdown children, `{expr}`, comments; the `JPD` diagnostics | slice 2 |
| 4 | `.auwla.md` as a compiler-next built-in language; Vite and Bun with no option; hot replacement | slice 3 |
| 5 | `headings`; code-fence highlighting at build time (Shiki's synchronous highlighter with Auwla's TextMate grammar) | approval of Shiki |
| 6 | Editor: mapper projection for `*.auwla.md`, recovery, highlighting | slice 3 |
| 7 | The docs site, written in documents | slices 4–6 |

## Acceptance for slices 2–4

- A document imports a component and a component imports a document.
- Two places showing one document stay independent; module state in an ESM block is shared.
- A reactive value and an event through an embedded component update in both compiler modes.
- A document with no component compiles to templates with no update code, and ships as HTML
  where compiler-next delivers static pages.
- Errors land at authored positions; copied characters map exactly.
- A Vite build, the dev server and hot replacement work with no option.
- Tests use their own fixture apps, never the examples (rule 16).
