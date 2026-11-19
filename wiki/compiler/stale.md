# Stale checks

A derived value updates when something it reads reports a change. An edit the compiler cannot
see reports nothing: one made in a file it does not compile, inside a library, or through a
reference that plain code kept and edits later. The value keeps what it was, and nothing says so.

In a dev server's browser build, the runtime looks for such values and says which one went out
of date.

## How it works

- **Compiler** (`src/features/stale/`). With `staleChecks` (default: the same as `hot`, and never
  for a server build), each component registers its plain derived values after its setup:
  `_MD.watchStale(_entity, "./App.tsx#App", [{ name, inputs, read, compute }])`. `compute` is the
  initializer, rewritten as its replay is.
- **Runtime** (`runtime/src/stale.ts`). 300 ms after a commit, with no update pending, it computes
  each value again and compares it with what the value holds. Values compare by their data:
  computing a list again makes a new array. A value that differs gets a second look a second
  later. It is reported only if it still differs and computing it gave the same result both
  times, so a value that reads the clock or chance (`Math.random() + count`) is never reported.
  Each value is reported once.

The report names the value, its component and file, what it holds and what it should hold, and
what it reads:

```
[memoized-dom] `open` in App (./App.tsx) is out of date.
It holds 2 items, but computing it again gives 1 item.
Nothing it reads (`rows`) reported a change, so it didn't update.
…
```

`globalThis.__MEMOIZED_DOM_STALE_CHECKS__ = false` turns the checks off.

## What is registered

Computing a value again must be safe, and must agree with it whenever nothing went wrong. So
only a `Derived` binding computed from its initializer alone is registered. These are not:

- a value reassigned or edited after it is made (it holds what that left, by design);
- one that later statements also build, or that shares a step with another value;
- an initializer that writes (`count++`, `seen.push(name)`), or an object field that reads
  nothing and does something (`{ id: nextId++ }`), which runs once;
- a value read from a ref: the page changes measurements without telling anyone;
- one declared after an early return, or in a nested block;
- `Opaque` bindings. A setup call the compiler cannot see into, such as
  `const stop = blockNavigation(…)`, can be one, and computing it again would do its work twice.

Re-running a derived initializer is something replay already does whenever its inputs change,
so computing one again to check it adds no new risk.

## Limits

- Checks run after a commit. An edit nobody heard starts none, so the report comes after the
  next commit, from any click.
- A value read from a library's own store (`Opaque`) is not checked.
- Only derived bindings are checked, not expressions written directly in markup.

## Cases

`src/features/stale/stale.test.ts`: what is registered, no output without the option or on a
server, a report for an edit made in plain code the compiler never sees, and no report for a
correct page or a value that reads chance.
