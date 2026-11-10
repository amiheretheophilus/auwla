# Markup bodies and grammar

State: accepted authoring direction; grammar and implementation open.
Owns DX-14, DX-25, DX-26 and keyed identity questions DX-15.

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

These are design inputs, not currently supported TSX.

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

## Questions P1 must make concrete

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

Mandatory semicolons, newline-only separation and the old `key value` loop suffix
are not accepted rules. Record a provisional choice and counterexamples after
the experiment, then revise it if the next slice disproves it.

## Acceptance examples

Keep the concrete fixture and expected result beside the future tests. These IDs
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

Prototype parser, lowering and tests: **planned**, mapped in
[architecture.md](architecture.md). Existing branch/list files remain owned by
their [compiler pages](../wiki/compiler/README.md). No new grammar case has run.
