# Open issues

## Bugs and limitations

Compiler bugs and cases live on their `compiler/` page, under "Cases to test".

- **Server package tests** have pre-existing order-dependent failures.
- **Compiler README** does not describe the readiness behaviour yet.

## To discuss with the user first (2026-11-04)

- **Unknown calls keep their deep before/after snapshot** (`observeMutation`,
  decision of 2026-10-19). Its code is about 1.5 kB minified (560 B gzip); the rest of
  `mutation.ts` is the alias index, which any compiled edit needs. Its real cost is
  speed: about 70 ms per call on 10k rows. Always reporting instead breaks effects:
  with handler calls always reported, 3 of 18 effect cases failed, and doing it during
  render hung the suite. Proposed: keep it as the fallback, and skip it where only
  render sites read the value, since re-rendering there cannot be seen.
- **Edits with no name to hold them.** `first().label = 'b'` reports, but only plain
  assignment is planned (`planCallRootedStores`). From reading the code, not tested:
  `first().count++`, `delete first().label` and `first().tags.push(1)` stay unreported.
- **Effect after `rows = rows.slice()`.** An effect reading `rows.length` re-runs on
  the compilers, old and new, and not on the reference. Not investigated.
- **A known name is trusted across modules.** A class in another file with its own
  `slice` that edits its receiver is no longer observed. A class in the same file is
  (`redefinedNames`).

## To discuss with the user first

The user wants to explain these before any work starts:

- an `html` binding;
- `fail()`;
- GET object params;
- nested middleware;
- `$define`.