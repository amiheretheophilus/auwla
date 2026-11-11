# Open issues

## Bugs and limitations

Compiler bugs and cases live on their `compiler/` page, under "Cases to test".

- **R23 on the old compiler** (`tests/r23-local-state.test.ts`, one failure):
  `new WeakMap([[token, …]])` reads a local, so since `6230c271` it is rebuilt and loses
  `.set`. Left unpatched by the 2026-10-19 decision to stop patching those passes.
  compiler-next passes the same program (`tests/cases/state-and-derived.test.ts`), after
  this test exposed two bugs there: weak collection edits were never seen, and a group
  re-run created its other members again and lost their edits.

## Decisions needed from the user (2026-11-06)

- **Positional props: `function Count(value) { … }`.** On the old compiler, a parameter that is not
  destructured is the prop of that name, so `<Count value={1} />` gives `value` the number, and
  `function Row(props)` with `<Row a={1} />` is an error ("unknown prop 'a' … declared props: props").
  On compiler-next it is plain JavaScript: the first parameter is the props object, so that `value`
  prints `[object Object]`. Nothing warns about it. The README and every example destructure or take no
  parameters, but 38 root test files use the old form. The two cannot both hold, since a compiler cannot
  tell `Count(value)` from `Row(props)` by looking. Recommended: keep plain JavaScript, because it is what
  TypeScript types and readers expect, and have the compiler report a prop read that can only be the
  whole object in text. If you want positional props, it is a small change in `features/props`.
- **What to do with root tests tied to the old compiler** (`compiler/testing.md`, "Acceptance"). 514 of
  825 failures can never pass on any rewrite: 329 assert the old compiler's generated text, 94 its error
  messages, and 91 call compiled components with its internal signature. Rule 7 forbids editing them
  to pass. Recommended: delete the text assertions along with `packages/compiler` at exit, and go through
  the error messages with you, since each one is a program the old compiler refused.

- **Running authored code at build time to find static pages** (`compiler/delivery.md`). The old
  compiler's rule is "planning never executes an authored function": it models JavaScript in a
  1,095-line evaluator, and every builtin it does not model sends the whole page to the browser
  (a pure helper, `.filter().map()`, `Math.max`, a `for` loop, `if (x) return`). compiler-next
  instead runs the program in a closed world, with only modules in the graph and allowed globals, so
  it has JavaScript's exact semantics and no list of builtins to keep up to date. The cost is that a
  component with an endless loop would hang the build, as it would hang the browser. Recommended:
  run it. Work is proceeding this way, and can be replaced by a model later if you prefer.

- **Uncompiled code editing data outside any call the compiler sees.** A package keeps a reference to
  `list`, and a later unrelated call pushes to it: the reference shows it and compiled code does not
  until that state updates (`handlers.md`). Seeing it means snapshotting every root that ever reached
  unknown code on every unknown call, which is about 70 ms a call at 10k rows. `rows = rows` is the
  way to report it by hand. Recommended: leave it, and document `rows = rows`. An animation library
  (`animate(box, { value: 100 })`) is the plainest case: the old compiler re-read such a value every
  frame, compiler-next shows only the value at the call (found by the replay, `compiler/testing.md`).
- **Adopting server HTML detaches the nodes inside regions, components and rows for a moment**
  (`compiler/delivery.md`, "Adopting existing nodes"). They go back within the same task, before any
  paint. Focus, the window's scroll, each element's scroll and a playing medium's time and state are
  restored. An iframe inside such a node loads its page again, which script cannot prevent. In-place
  claiming would need every template walk to skip region content, which costs every client render.
  Recommended: accept it for iframes.

## To discuss with the user first (2026-11-05)

- **A plain function differs from the reference in one case.** A value only an unknown
  call might change runs once in compiler-next, and is recomputed in the reference
  (`decisions.md`, 2026-11-05). JavaScript agrees with compiler-next here. Reversible.
- **An opaque call snapshots everything the argument's root can reach.**
  `dset(models[index], …)` walks all of `models`: about 0.5 ms per click at 128 items.
  Narrowing to `models[index]` would miss a package that was given the whole list earlier
  and edits it when handed one element, which the full snapshot catches. Left as it is.

## To discuss with the user first (2026-11-04)

- **Unknown calls keep their deep before/after snapshot** (`observeMutation`,
  decision of 2026-10-19). Its code is about 1.5 kB minified (560 B gzip); the rest of
  `mutation.ts` is the alias index, which any compiled edit needs. Its real cost is
  speed: about 70 ms per call on 10k rows. Always reporting instead breaks effects:
  with handler calls always reported, 3 of 18 effect cases failed, and doing it during
  render hung the suite. Proposed: keep it as the fallback, and skip it where only
  render sites read the value, since re-rendering there cannot be seen.
- **A known name is trusted across modules.** A class in another file with its own
  `slice` that edits its receiver is no longer observed. A class in the same file is
  (`redefinedNames`). Four programs tried on 2026-11-06, including an `Array` subclass held in
  state, could not show a wrong page (`tests/cases/coverage.test.ts`, r01, r02). Widening the check
  to the whole graph would let one package's `map` method turn off list fast paths everywhere, so
  it is left as rule 3 has it unless a failing program turns up.

## To discuss with the user first

The user wants to explain these before any work starts:

- an `html` binding;
- `fail()`;
- GET object params;
- nested middleware;
- `$define`.