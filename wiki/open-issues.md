# Open issues

## Bugs and limitations

Compiler bugs and cases live on their `compiler/` page, under "Cases to test".

- **Server package tests** have pre-existing order-dependent failures.
- **Compiler README** does not describe the readiness behaviour yet.
- **Source generator seed 194088594** (`FC_SEED=194088594 FC_RUNS=200 bun test
  tests/generator/sources.test.ts`) fails, at `685e262c` too, so it predates the
  2026-11-04 work. In `let l0 = []; if (0 > l0.reduce(…)) d0 = 0; if
  (!l0.includes(0 + s0.value)) d1 = 0;` with `s0` loading, `{d0}` shows the pending
  view after an unrelated click, where the reference shows `0`. `l0` waits because a
  waiting statement calls a method on it, "whatever the method" (decision of
  2026-10-19); the reference re-evaluates after the click, the compiled builder does
  not. `includes` is now a known read, so `l0` need not wait at all, but that changes
  the 2026-10-19 decision, so it is left for the user.

## To discuss with the user first (2026-11-04)

- **Unknown calls keep their deep before/after snapshot** (`observeMutation`,
  decision of 2026-10-19). It checks no prototype, but it is the largest remaining
  runtime: `mutation.ts` is about 5.7 kB in any app with one unknown call. Treating
  an unknown call as "may have edited its receiver" and always reporting it would
  remove the snapshot, at the cost of re-running readers when nothing changed.
- **A known name is trusted across modules.** A class in another file with its own
  `slice` that edits its receiver is no longer observed. A class in the same file is
  (`redefinedNames`).
- **Row updates on a structural change.** Every row still evaluates its sites when
  the list reconciles. The old compiler skips rows whose item is the same object on
  a structural write, which is faster but shows stale text if uncompiled code edited
  that item. Not done, because it changes what shows.

## To discuss with the user first

The user wants to explain these before any work starts:

- an `html` binding;
- `fail()`;
- GET object params;
- nested middleware;
- `$define`.