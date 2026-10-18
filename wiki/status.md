# Status

Last updated: 2026-10-18.

## Branches

- `compiler-refactor` (working branch). Created from `stress-round-5` at `73f5f34`.
- `codex/package-conditional-sync` at `9e35480` (third-party package compilation,
  development inspector, authored JSX diagnostics) is merged in as `616348a`,
  without conflicts. Merged so that branch is not stranded by the refactor.

## Done

- `73f5f34`: readiness. Code that depends on a loading source waits for it:
  - state seeds (`let tab = me === null ? ...`), through `seedResolvedValues`;
  - early returns on a source, rewritten into one conditional return;
  - effects that read a source or a derivation of one;
  - chained requests built from another source (provider and factory helpers);
  - module and local sources alike.
  Covered by `tests/body-readiness.test.ts` (10 cases, all passing).
- `73f5f34`: server renders real HTML; SSR group errors and null-source branches
  (`tests/ssr-group-error.test.ts`, `tests/ssr-null-source-branch.test.ts`).
  Vite suite 180/180.

## Verified on the merged tree (2026-10-18)

- `bun install` was needed: the merged devtools package adds
  `@fontsource-variable/geist` and `geist-mono` (already in `bun.lock`).
- `bun run build` passes.
- 80/80 pass across `body-readiness`, `ssr-group-error`, `ssr-null-source-branch`,
  `third-party-package-compilation` and `third-party-runtime-bench`.

## Not yet verified

- The full root suite on the readiness changes and on the merged tree.
  It runs out of memory on the local machine. A pay-per-use remote machine
  (GitHub Codespaces) is being set up; the user is sorting out billing.
- The server package has pre-existing order-dependent failures.

## Next

1. Build and test the merged tree (remotely once Codespaces is ready).
2. The user reviews `design.md` (draft written 2026-10-18) and answers its **Q** items.
   No refactor code until then.
3. Reactive refs.
4. Update the compiler README for the readiness behaviour.
