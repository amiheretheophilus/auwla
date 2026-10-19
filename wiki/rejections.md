# Valid JavaScript the compiler rejects (rule 10 backlog)

Rule 10 (`rules.md`): every JavaScript expression is accepted, and every effect
the console would show must show on the UI. A compile error for valid JavaScript
is a bug.

The compiler has about 305 distinct `memo-dom:` messages. Most are internal
invariants ("missing … plan") or contracts of the framework's own APIs
(`route-to`, `define.function()`, `$routed`, `Group`, slots, `page()`,
`mount()`, server functions, TSRX `@try`, packages). Those stay. The list below
is ordinary JavaScript/JSX, each case checked by compiling it
(`packages/compiler/scripts/valid-js-probe.ts`, 2026-10-19).

## Fixed

| Case | Fix |
| --- | --- |
| `const items = makeList()` written and rendered as a list | `0afbf08`, written const is state |
| Writes or read-only methods on `[1].concat([2])` results | `0afbf08` |
| Reassigning or `++` on a prop binding | prop override (status.md) |
| `sorted.push(x)` on `const sorted = items.slice()` did not show | edited copy is kept even when it may alias its source (status.md) |

## Rejected today (confirmed)

| Case | Message | Notes |
| --- | --- | --- |
| `load().map(i => <li/>)` | list views must come from reactive … state | A call result is opaque: re-evaluate on owner update. |
| `items.map((item, i, all) => …)` | list callback must take an item … and optional index | Third argument is the array itself. |
| JSX pushed in a `for` loop into an array, rendered as `{rows}` | JSX built in a loop … runs once and never updates | Needs the render plan: an opaque JSX-producing block re-run on update. |
| `<UI.Box>` (member tag) | 'UI' contains JSX but is not a plain function | Object of components. |
| `<Child a={1} b={2} />`, `b` undeclared | unknown prop 'b' on <Child> | An extra prop is valid; it is just unused. |
| `<p key="x">` outside a list | key={...} is only meaningful on list rows | Harmless attribute; ignore it. |
| `onClick={actions.go}` | unsupported onClick handler form | Member reference handler. |
| `onClick={make()}` | unsupported onClick handler form | Call result as handler: evaluate at render. |
| `$effect(async () => …)` | effect callback must be synchronous | Async body: run it; the teardown is whatever it resolves to, or none. |
| `enum Mode { A, B }` | runtime TypeScript syntax 'TSEnumDeclaration' | Lower enums to objects (as TypeScript does). |
| `<p>{...items}</p>` | spread children are not supported | Render the array. |

## Accepted and correct on the UI (checked at runtime, `tests/visible-effects.test.ts`)

Assigning a written `let`, reassigning a module store, writing a module
computed, chained and value-position assignments (`a = b = 1`,
`last = count++`), maps over module consts, filter-then-map, `map(Row)`,
`$effect` inside `if`, `switch` on state, `??` in JSX.

## Still to check

Messages that read as rejections of valid code, not yet probed: derivation
writes at module scope (`cannot assign computed`), "handler assigns X which is
neither module state nor a handler local", "control flow … test is not
replayable", "destructuring snapshots reactive state", "module-state write
cannot produce a value" (server builds), "conditional cannot choose between two
data sources", `$cleanup` placement, `[MMD-S004]` source destructuring.

## Open semantic question for the user

A written `let total = a * 2` is plain state: set once, a later `a = 7` does not
re-derive it (as in the console). A `const sorted = items.slice()` that is
edited keeps the edit until `items` changes, then re-derives (existing
behaviour, `tests/derived-const-mutation.test.ts`). Both are defensible; they
differ.
