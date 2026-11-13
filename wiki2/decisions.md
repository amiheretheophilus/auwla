# Prototype decisions

Updated: 2026-11-13. Accepted direction is separate from implemented support.

## Accepted directions

| ID | Date | Decision and evidence | Contract |
| --- | --- | --- | --- |
| DX-43 | 2026-11-13 | User authorized starting implementation after the CSS plan, then said not to commit any current work. CSS-1 provisionally requires explicit `<style global>` for the first native CSS slice, leaving local/default scope open. Syntax extraction stays pure in JSX+; the compiler's generic language hook owns assets and existing adapters own delivery. This is a narrow implementation choice, not acceptance of the full styling design. | [CSS-1 spec](spec/styles.md), [implementation](styling.md) |
| DX-41 | 2026-11-13 | Use native CSS first, then compact/grouped conditions on ordinary properties, then optional property aliases such as `p` and `bg`. User: "i planned on droping tailwind to just use the native css" and "we will start wit the normal css then later we add the short hands like p and co". Supersedes the earlier Tailwind provider proposal. Alias units/scales and scope defaults remain open. Planning/documentation only; the user explicitly said implementation had not been requested. | [CSS design](../dxcss.md) |
| DX-42 | 2026-11-13 | Conditions include author-controlled classes: `@.loading` matches the same element carrying `loading`, whether the class is static or controlled by existing expressions. Future dot-style classes on elements produce the same ordinary DOM classes; exact element grammar remains open. Full-property example: `padding:4px @md:30px @.loading:40px`. CSS conditions compile to native selectors/media rules; no CSS runtime or JS condition evaluator. Application JS may still update classes through existing reactivity. | [class conditions](../dxcss.md#6-author-controlled-class-conditions), [compilation](../dxcss.md#7-compile-time-css-and-existing-compiler-ownership) |
| DX-39 | 2026-11-13 | JSX+ is a standalone template layer: for builds it is only a compiler-next source language (`auwla`), and compiler-next owns projects, imports across files, applications, the CLI, the Bun and Vite plugins, source maps and hot updates. JSX+ has no build path of its own and no Bun/Node API in `src/`. User, on another agent's JSX+ project wrapper and Bun plugin: "it has started duplicating the project the compiler next is meant to handle and be doing bun stuff in the jsx plus as if the jsx plus is meant to run on bun only", and "eventually jsx plus will become a standalone template layer ... delete that project". That uncommitted work was discarded. Built: compiler-next's generic `languages` option (DX-34, logged in [status](status.md)), `auwla`, and the multi-file notes example through the project, Bun and Vite plugins. Refines DX-28/DX-31. | [architecture](architecture.md), [compiler source languages](../wiki/compiler/core.md#source-languages) |
| DX-40 | 2026-11-13 | Relative imports of `.auwla` files name the extension (`'../people.auwla'`). TypeScript loads a content-mapped file only when the import names its extension, and `paths` never applies to a relative import; aliases may leave it out through a `paths` fallback (`"#server/*": ["./server/*", "./server/*.auwla"]`). The build accepts both. Offered: keep this rule, rewrite extensionless imports in the checking view, or ask TypeScript upstream; user: "option a is okay". | [tooling](tooling.md), [examples](../packages/jsx-plus/examples/README.md) |
| DX-37 | 2026-11-11 | Add interpolation inside quoted markup text. User selected `Inside quoted text: <p>"Count: {count}"</p>`. Built in spec r7 with native template coercion, `\{` escaping, exact mappings and real editor-protocol checks. Existing native template `${...}` support remains. | [syntax](syntax.md), [spec](spec/README.md) |
| DX-38 | 2026-11-11 | Enable framework types once per project so `.auwla` files do not need a per-file JSX type import. User: "cant we create .auwla file without this???". The `./types` export reuses existing contracts; the counter config demonstrates it. Standalone inferred-project type setup is still open. | [tooling](tooling.md), [examples](../packages/jsx-plus/examples/README.md) |
| DX-36 | 2026-11-11 | Keep editor integrations decoupled so other extensions can reuse the language tooling. User: "the editor extension should be decoupled so that other extension". Shared projection, recovery, mapper and reusable assets stay independent of editor SDKs; per-editor adapters depend on them. First adapter/assets built; the user reported the task board working in desktop VS Code with the local VSIX (2026-11-11). Second-editor compatibility remains unverified. | [tooling](tooling.md#editor-extension-planned-p3-editor), [architecture](architecture.md#proposed-placement) |
| DX-01 | Before this prototype | Use TypeScript content mappers; recorded in `dx.md`. Packaging and version-specific behavior still need a probe. | [tooling](tooling.md) |
| DX-19 | 2026-11-10 | Keep normal ref declarations and the existing `ref` prop. User: `the ref i want to matain the old way like normal variable decalration with the ref props nothing like "$"`. Supersedes the tag-declared ref proposal. | [refs](refs.md) |
| DX-25 | 2026-11-10 | Quote literal markup text; read expressions directly. User: `instead of having <div>text</div> why not <div>"text"</div>`. | [syntax](syntax.md) |
| DX-14 | 2026-11-10 | Explore direct control flow and ordinary expressions without an outer child-expression container. User: "if statments and stuff without {} and even real expression stuff like .map and stuff without these {}". JavaScript block/object braces retain their roles. Exact grammar is open. | [syntax](syntax.md) |
| DX-27 | 2026-11-10 | Create `wiki2` for the map and plan, and iterate as evidence arrives. User: "since it agile approach we are using we can make changes we go". | [plan](plan.md) |
| DX-28 | 2026-11-10 | Reuse compiler-next's production pipeline and existing refs. User: "this doesnt take a different path from the compiler next" and "the ref exists already". DX-31 later clarifies that syntax implementation lives in a separate package; it does not change this semantic reuse. | [architecture](architecture.md), [refs](refs.md) |
| DX-29 | 2026-11-11 | Define a language spec before implementing the syntax, informed by the organization of `snrraptopack/jasx`. User: "before they started they had a proper language spec". The spec remains a revisable draft under DX-27. | [spec](spec/README.md) |
| DX-30 | 2026-11-11 | `.auwla` may contain pure nonreactive backend code and ordinary backend imports such as Express. Config will select backend files/folders; isomorphic support comes later. User: "backends are not even reactive" and "we will have a config that will point to backend files or folder". Exact config syntax and implementation remain planned. | [architecture](architecture.md#backend-authoring-planned), [spec](spec/README.md#backend-authoring-direction-planned) |
| DX-31 | 2026-11-11 | Keep JSX+ implementation in its own package, `packages/jsx-plus`, passing normalized source into compiler-next through its public API. User: "it a different package i dont want u to mix it". Supersedes earlier plans to put the syntax implementation inside compiler-next's parse folder; existing pipeline/ref reuse under DX-28 remains. | [architecture](architecture.md) |
| DX-32 | 2026-11-11 | Allow `prop=(expression)` alongside existing attribute braces. User: `aria-label=("Remove " + task.title)` and "reply and continue". Preserve ordinary expression/event evaluation; after discussing automatic event-call deferral, the user said "just forget it and continue". Bare/lazy event calls are not introduced. | [attributes](spec/grammar.md#attributes-and-existing-refs-g-attr), [syntax](syntax.md) |
| DX-35 | 2026-11-11 | Direct `for (const binding of iterable) { children }` lowers to `Array.from(iterable, (binding) => row)` for full iterable semantics. Its body holds child items only, as in `if` blocks. Offered options: `.map` (arrays only, fast rows today), `Array.from` with or without teaching compiler-next its row fast path, and whether bodies allow declarations; user: "pick the ones u think it best". Chosen: `Array.from` + compiler-next fast path (the fast path is a separate pending slice), children only. | [spec S-FOR](spec/semantics.md#loop-children-s-for), [syntax](syntax.md#direct-loops) |
| DX-34 | 2026-11-11 | On this branch, compiler-next may be changed where `.auwla` interop needs it, and reconciled with `compiler-rewrite` later. User: "we can effectively modify the part we need to be able to interopt with our working version freely and later sync or correct that changes when the orginal rewrite doesnt agree". Compiler-next itself stays unfinished and is continued by a separate agent; DX-31's package boundary for syntax code is unchanged. Record each such change in [status](status.md) under "Compiler-next changes to reconcile". | [architecture](architecture.md) |
| DX-33 | 2026-11-11 | Accept a single bare identifier as an attribute value: user asked for `onClick=addTask`. Normalize to ordinary JSX `onClick={addTask}` and preserve native event delivery. This extends DX-32's spelling without adding bare calls or automatic deferral. | [attributes](spec/grammar.md#attributes-and-existing-refs-g-attr), [syntax](syntax.md) |

## Provisional choices

- `.auwla` is the working extension, pending the parser/tooling experiment.
- The earlier child-only scope is superseded by DX-32: attribute braces remain
  available alongside optional parenthesized attribute expressions.
- Fine-grained file placement and checking projection remain revisable within
  the separate syntax package. Production compilation is delegated to compiler-next;
  a future TypeScript mapper does not produce the application's runtime program.
- [Core spec revision 1](spec/grammar.md) provisionally preserves host continuation
  and ASI, uses explicit separators at ambiguous boundaries, treats quoted child
  strings as host strings without JSX entity decoding, and requires direct `if`
  bodies to be blocks. These are initial draft choices backed by fixtures, not
  final user acceptance of every grammar detail. Mandatory semicolons after every
  child have not been accepted. Direct child declarations/loops and outward
  completion semantics remain later design work.

These choices can be revised in a slice without pretending they were user decisions.

## Record a change

For a new accepted decision, add its date, the concrete behavior, the reason or
user wording, the concept-page link and any superseded decision. Preserve the
older reason when reversing a choice. Keep experiments and measurements on the
concept page; do not turn every implementation detail into a permanent decision.

The rest of [dx.md's decision register](../dx.md#17-decision-register) remains
open or recommended as labeled. Updating this wiki does not accept all those
features or change the established compiler reactivity rules.
