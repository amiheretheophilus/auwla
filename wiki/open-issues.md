# Open issues

## Bugs and limitations

- **Seed overwrites an early write.** If the user writes a seeded `let` before its
  source loads, `seedResolvedValues` later overwrites that write. Fix: stop the
  seed on the first authored write.
- **Same-module source helpers.** A helper in the same module that returns `$fetch`
  is not recognized as a source factory ("list views must come from reactive module
  state..."). Imported helpers work.
- **Refs are not reactive.** Users currently need a ref plus an effect.
- **Server package tests** have pre-existing order-dependent failures.
- **Compiler README** does not describe the readiness behaviour yet.

## To discuss with the user first

The user wants to explain these before any work starts:

- an `html` binding;
- `fail()`;
- GET object params;
- nested middleware;
- `$define`.
