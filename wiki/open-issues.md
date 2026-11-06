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

- **A source reached in a way the compiler cannot name crashes while it loads.**
  `queries[tab].name`, `store.user.name` on a class instance and `map.get('user').name` throw
  `UnresolvedDataReadError` instead of waiting, against rule 8. Every such site already runs inside
  `whenSourceInputs`, so a catch there that treats only this error as "waiting" and rethrows anything
  else would fix them all, including `getUser().name`. But that wraps authored code in a runtime
  `try`, which rule 5 forbids, so it was not done. The alternative is static: naming computed keys,
  class fields and `Map.get` in the read path, which is more code in the compiler, the data runtime
  and the reference, and still leaves calls crashing. Recommended: allow the one catch.
- **Uncompiled code editing data outside any call the compiler sees.** A package keeps a reference to
  `list`, and a later unrelated call pushes to it: the reference shows it and compiled code does not
  until that state updates (`handlers.md`). Seeing it means snapshotting every root that ever reached
  unknown code on every unknown call, which is about 70 ms a call at 10k rows. `rows = rows` is the
  way to report it by hand. Recommended: leave it, and document `rows = rows`.

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