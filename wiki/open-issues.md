# Open issues

## Bugs and limitations

Compiler bugs and cases live on their `compiler/` page, under "Cases to test".

- **Server package tests** have pre-existing order-dependent failures.
- **Compiler README** does not describe the readiness behaviour yet.

## To discuss with the user first

The user wants to explain these before any work starts:

- an `html` binding;
- `fail()`;
- GET object params;
- nested middleware;
- `$define`.
- Two reference problems found by the Phase 4 audit (2026-10-24): a returning
  statement that mutates data never settles, and a `var` in a once-only setup
  statement is lost. Details and what compiler-next does:
  `compiler/conditionals-and-lists.md`, "Early returns".
