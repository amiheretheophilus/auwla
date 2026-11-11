# Markup bodies and grammar

State: core fixtures and initial host-context hardening implemented in `packages/jsx-plus`.
Owns DX-14, DX-25, DX-26 and keyed identity questions DX-15.

Precise rules now live in [spec/grammar.md](spec/grammar.md),
[spec/ast.md](spec/ast.md) and [spec/semantics.md](spec/semantics.md). This page
maps the work and remaining investigations; it does not define a competing grammar.

Implementation lives in its own package and passes normalized standard TSX to
compiler-next's public API. Ordinary expression rendering, `.map()`, list identity
and refs already exist. New code changes their source spelling and direct child
control flow without mixing implementation into those existing package sources.
See [architecture.md](architecture.md).

## Current contract

- Literal child text is quoted: `<p>"Hello"</p>`.
- Direct child expressions need no outer `{}`: `<p>user.name</p>` and
  `<p>"Total: " + total</p>`.
- Direct `if` and ordinary expressions such as `.map()` belong in markup bodies.
  JavaScript blocks and object literals still use braces.
- Normal JavaScript outside markup retains its behavior. Rendering expressions
  in a markup body is part of the new format's contract, not a change to every JS
  block. Existing JSX/TSX retains its grammar.
- Attribute expressions accept `prop={expression}` and `prop=(expression)`
  (DX-32, spec revision 2). Both retain ordinary value/event timing. Event
  callbacks remain explicit; bare `onClick=handler(...)` is not introduced.
- DX-33/spec revision 3 additionally accepts `prop=name` for one bare host
  identifier. `onClick=addTask` passes the function, with native event arguments.

## Bare identifier attributes

`src/attributes/identifier.ts` reads a candidate up to an attribute/tag boundary,
then requires the host parser to return one identifier without errors. It does
not parse general expressions by string replacement. Unicode/escaped identifiers
keep their exact source spelling; unknown names retain normal TypeScript errors.
Non-identifiers need parentheses or existing JSX braces. Since spec revision 4,
an undelimited non-identifier (`onClick=handlers.add`, `value=true`, `a/b`)
reports JPX1009 over the value instead of a raw host parse message. The value
runs to whitespace, `>` or `/>`, so `onClick=addTask ()` still accepts `addTask`
and fails on the stray `()`. A top-level child comma reports JPX1005 at the comma.

In the parser-only opening-tag placeholder, the equals sign and identifier are
blanked while preserving UTF-16 width and newlines. This leaves a boolean
attribute for scanning, including one-character names. Emission instead retains
the real assignment and copies the identifier between unmapped generated braces.

The actual apps use `onClick=addTask` and `onSubmit=addTask`. Their runtime checks
exercise native event delivery. A real LSP test renames the bare submit handler
and its declaration with exact authored edits, then rechecks successfully.

## Parenthesized attribute values

`aria-label=("Remove " + task.title)` normalizes to ordinary JSX
`aria-label={("Remove " + task.title)}`. Existing braces can be mixed with the
new form. The actual task-board example uses it for a row label, a status prop,
an explicit click callback and its existing ref.

`src/attributes/parenthesized.ts` reads balanced values with host tokens and
recursively normalizes nested markup. Opening-tag placeholders preserve UTF-16
width and line endings. The original parentheses/expression remain copied
spans; inserted JSX braces are unmapped. Generic functions, nested objects,
templates, regexes and comparisons retain host parsing. Await/yield stay in their
authored function context. Parser AST nodes are untouched.

The reader reports JPX1008 at an unclosed outer `(` and JPX1003 at an unclosed
literal's authored opener, skipping comments through host-provided ranges.
Empty/malformed closed values still receive host syntax errors. The small
conformance view continues to omit attributes; actual normalized TSX/mapping,
native CLI/LSP and runtime checks provide additional evidence.

An actual LSP test edits the task-board label to `task.ti`, verifies TS2339 at
the authored token, resolves `title` completion, applies the server's actual
insert/replace edit and rechecks without diagnostics. This establishes one
member-completion path; auto-import and broader recovery remain open.

## Examples for the first slices

These are extended-source inputs. The separate package normalizes the current
quoted/expression/conditional fixtures into supported standard TSX.

```tsx
<section>
  <h1>"Tasks"</h1>
  <p>tasks.length</p>

  if (tasks.length === 0) {
    <p>"Nothing to do."</p>
  } else {
    <ul>
      tasks.map(task => <li key={task.id}>task.title</li>)
    </ul>
  }
</section>
```

The `if` block's braces express its block; there is no extra pair around the
whole `if`. Chained calls, ternaries, functions and computed reads must remain
ordinary expressions. Direct loops are below.

## Direct loops

Spec: [G-FOR](spec/grammar.md#loop-children-g-for) and
[S-FOR](spec/semantics.md#loop-children-s-for); decision DX-35.

```auwla
<ul>
  for (const task of visible) {
    <li key={task.id}>task.title</li>
  }
</ul>
```

normalizes to `<ul>{Array.from(visible, (task) => <li key={task.id}>{task.title}</li>)}</ul>`.

- **Body scan** (`markup/element.ts`): a `(` after child-level `for` is a
  header, exactly like `if`. The `{` after its `)` is a child block that is
  read with the child grammar and cached.
- **Lowering** (`markup/children.ts`, `loop()`): the iterable and binding are
  copied exactly, in generated order iterable-first; `Array.from(`, `, (`,
  `) => ` and `)` are generated and unmapped. A single element/fragment body is
  the row (its `key` is the row key); anything else is wrapped in `<>...</>`.
- **Rejected forms**: JPX1010 for anything but `for (const ... of ...)`; JPX1006
  for a non-block body; statements in the body are outside the profile; `await`
  in a body fails host validation at its authored location.

Evidence: spec fixtures PARSE-009, ERROR-009/010, FOR-001 (keyed reorder keeps
nodes) and FOR-002 (a `Set` with per-row closures), in both compiler modes.
`tests/loops.test.ts` covers destructuring, nesting, multi-child rows, all
rejected forms and exact binding/iterable mappings via TypeScript's `SpanMap`.
The main task board,
[App.auwla](../packages/jsx-plus/examples/task-board/App.auwla), writes two
direct loops in its template. One loops over a module-level `filters` array to
make the status buttons. The other loops over `visible` inside the `else` branch
of a direct `if` to make the task rows. Its execution test runs in both modes. It
checks the looped buttons' labels and `aria-pressed`, that each row's handler
acts on its own binding, that open rows keep their nodes across a filter change,
and the add/toggle/remove/search flow. It builds and type-checks through the TS7
CLI. The LSP completion, auto-import and editor-recovery tests edit inside its
loop body. A real LSP rename of the row loop's binding edits only uses inside
that loop.

**Compiled rows (P4-FOR-FAST).** With optimization on, compiler-next treats
`Array.from(items, row)` like `items.map(row)`
([optimize](../wiki/compiler/optimize.md#row-lists),
`optimize/mapping-calls.ts`). A loop whose body is one keyed element becomes a
compiled row list (`createRowList`, then `list.from(items)`). A multi-child body
(a fragment row) uses the per-item row cache (`fromRows`). The runtime iterates
exactly what `Array.from` iterates. Both of the task board's loops compile to
`_rowList.from(...)`.

Known limits (compiler-next, same as plain JSX `Array.from`):

- Closed-list proofs follow only `x.map(cb)`, so a loop evaluates every row
  on each pass. It does not skip rows whose item is unchanged (`moved`).
- Only the intrinsic global `Array.from` is recognized. A module that declares or
  assigns `Array`, or defines its own `from`, keeps the general path.
- Writes through a row binding (`task.done = ...`) are tracked when iterating a
  state-derived array directly, but **not** through `visible.entries()`.
  Compiler-next does not know `entries()` yields the array's own elements.
  Plain JSX `Array.from(visible.entries(), ...)` behaves the same.

## Initial answers and remaining investigations

P1 selected host continuation/ASI plus explicit separators at ambiguous boundaries
as its first provisional candidate. The current parser confirms seven baseline
shapes in [the catalog](spec/cases.json), including call/index continuation and
comparisons. String children use JS escaping without JSX entity decoding; direct
conditional bodies are blocks. These draft choices can change with counterexamples.

The full questions remain useful for later profiles and parser feedback:

| Question | Probe before choosing a rule |
| --- | --- |
| Adjacent expressions | `first` followed by `second`; `getValue()` followed by `[index]`; candidate explicit semicolons versus inferred boundaries |
| Operators and tags | `a < b`, `a > b`, generics, regex literals and nested/self-closing/closing tags |
| Text | Escaped quotes, template literals, multiline content, significant spaces and whether strings use JS escapes without JSX entity decoding |
| Children | Numbers, arrays, empty strings, nullish/boolean values and adjacent text nodes; preserve existing rendering behavior unless a difference is deliberately chosen |
| Blocks and scope | `else if`, siblings, nested blocks, locals, destructuring, shadowing and reads before declaration |
| Declarations | Whether declarations inside markup are supported, how values replay, and how they scope into the virtual program |
| Completion | Meaning of `return`, `break`, `continue`, `throw`, `await` and `yield` in markup blocks; do not silently insert a function boundary |
| Keys | Existing `key={id}` placement, omission, duplicates, changed keys and row-local ownership |
| Recovery | Missing quote, tag, brace or expression; retain useful ranges and tooling for later complete code |
| Compatibility | Whether legacy child containers are accepted in the new format; old `.tsx` is unchanged either way |

Mandatory semicolons after every child, newline-only separation and the old
`key value` loop suffix are not accepted rules. Implement the documented draft,
then revise it explicitly with counterexamples if the next slice disproves it.

## Acceptance examples

Keep concrete fixtures and expected results beside their tests. These IDs
make the backlog traceable without copying cases into status.

| ID | Check | Stage |
| --- | --- | --- |
| SYN-01 | Quoted `"Hello"` renders `Hello`; `message` reads a binding and follows its changes | P2 |
| SYN-02 | Arithmetic, calls, chains, templates and ternaries match explicit JSX equivalents, including side-effect counts and receivers | P2/P4 |
| SYN-03 | Adjacent-expression and operator/tag fixtures have one documented parse; incomplete versions recover | P1/P2 |
| SYN-04 | Direct `if` switches content; branch locals do not leak and branch refs dispose correctly | P4 |
| SYN-05 | `.map()` preserves keyed DOM nodes, handlers and row state through edit, move, insertion and removal | P4 |
| SYN-06 | String escapes, whitespace and entities follow the chosen rule in both DOM and server HTML | P2/P7 |
| SYN-07 | Existing JS/TS/JSX/TSX sources compile with their existing meaning | Each integration slice |
| SYN-08 | Source ranges and diagnostics identify authored expressions, including Unicode and incomplete syntax | P2/P3 |

Add declaration, loop and abrupt-completion cases when those constructs enter a
slice. These checks concern parser support for the new grammar; they do not
authorize rejecting valid JavaScript expressions to simplify compilation.

## Files and limits

Actual files are mapped in [architecture.md](architecture.md). Package tests now
cover all 6 parse views, 5 diagnostic fixtures and 9 extended behavior programs
in both compiler modes, plus lexical/mapping checks. Existing branch/list files
stay in their [compiler pages](../wiki/compiler/README.md) and are unchanged.

Conditional normalization groups the entire authored test before the generated
ternary, preserving assignment, comma and nested-ternary precedence. A branch
toggle with a ternary test is exercised in both compiler modes.

The package parses semicolon-separated child chunks in expression context first,
including object/function/class values following another child. Conditional child
bodies are parsed/cached before their contents are blanked for the host `if`
parse. Host continuation/ASI within a chunk still comes from yuku. Direct child
declarations remain outside the core profile; direct loops are covered above.

Parser-only async/generator contexts preserve `yield`/`await`, including yield
arguments in attributes and conditions. No runtime function is inserted; final
module parsing validates the authored enclosing context. A yield outside a
generator still fails. Native execution checks cover suspension/resumption and
await values; these are normalization evidence, not broad reactive-generator
acceptance. `super`, `new.target`, private reads and nested template/attribute
markup have focused syntax/mapping checks.

Expressions ending at a nested markup mask now expand their authored end through
the complete element, including a ternary's final arm or a yielded element. This
also applies to conditional tests. JPX1003 locates an unfinished template's
backtick, JPX1004 locates an incomplete expression's block end, and JPX1007 locates
an unclosed conditional's opening brace. Tests retain the token-before-block
diagnostic precedence for an unterminated string.

Broader host contexts, ASI ambiguities, malformed comment/regex recovery and
composed debugging maps need further coverage. Repeated suffix parsing/masking
needs measurement and improvement before a frontend scalability claim. Module
graphs, editor activation, SSR/adoption, Vite and backend config remain future
work. An initial headless TypeScript mapper now shares this normalizer; its
diagnostic/rename evidence and flow-typing limits are on [tooling.md](tooling.md).
