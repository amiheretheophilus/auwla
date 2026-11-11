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
- Attribute expressions remain `prop={expression}` in the working examples.
  This is provisional; a new attribute grammar has not been accepted.

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
ordinary expressions. A direct `for...of` is a later candidate with the same list
identity requirements; exact loop grammar is open.

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
declarations/loops remain outside the first core profile.

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
