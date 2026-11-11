# Verification and evidence

State: spec-integrity/current-JSX baseline checks available; extended syntax and
tooling conformance await their implementation.

## What a check establishes

| Check | Establishes | Does not establish |
| --- | --- | --- |
| Grammar fixture with an expected tree/ranges | A documented parse and useful recovery | Rendering or reactivity |
| Explicit execution assertion | The stated observable result, ordering or count | Untested interleavings |
| Comparison with separately authored JSX | Agreement with that equivalent on the exercised steps | Correctness when both paths share a bug |
| Mapper CLI/edited-source check | Authored types, spans or a specific safe edit | Full editor support or formatting |
| SSR/adoption case | Initial/delivered behavior and ownership for that case | Complete Vite integration |
| Correctness/work counters | Output and the counted amount of work | VM timings, memory acceptance or elimination of an OOM |

Keep production parsing/lowering out of the independent expected-value path.
Assert specific text, node identity, scope, side-effect counts and cleanup where
those are the contract. Inspect a mismatch before deciding which path is wrong.

## Cases and files

The language draft and fixtures live in [spec/](spec/README.md).
[Conformance levels](spec/conformance.md) distinguish fixture integrity, the host
baseline, extended parsing/diagnostics/behavior, tooling and delivery. Run the
checks currently available from the repository root:

```text
bun run wiki2/spec/check.ts
bun check -p wiki2/spec/tsconfig.json
```

These commands do not establish extended-source conformance. In particular,
passing a separately authored JSX equivalent is baseline evidence, not evidence
that the new markup parser accepts its source.

Acceptance IDs are owned by [syntax.md](syntax.md), [refs.md](refs.md) and
[tooling.md](tooling.md); later features add theirs on their concept page.
Planned prototype test placement is mapped in [architecture.md](architecture.md).
No nonexistent test command is presented here as a working gate.

Existing compiler compatibility cases are under
`packages/compiler-next/tests/cases/`. Ref behavior is in `refs.test.ts` and the
branch/list contracts are on their [compiler concept pages](../wiki/compiler/README.md).
Use the affected files and rebuild packages first when a suite imports `dist`.

## Practical check order

1. For documentation: check local links, existing mapped paths, planned-path
   labels, example consistency and `git diff --check`. Runtime suites are not
   needed for a documentation-only slice.
2. For implementation: type-check the touched package with `bun check`; run its
   focused grammar/mapping/unit cases and affected compiler behavior cases.
3. For shared compiler changes: include optimized/general comparisons and the
   relevant source, ref, branch/list or ownership regressions. Use the existing
   [testing guidance](../wiki/compiler/testing.md) for heavier batches.
4. For tooling: run the real pinned mapper/TypeScript path and apply returned
   edits back to source. Record permissions, versions and exact diagnostics.
5. For adoption: add a browser/application path, SSR/adoption and resource cleanup.
   Measure comparable builds before any output-size or speed claim. The user
   performs timing benchmarks on the VM as under the existing project rules.

Avoid the full root suite as a routine local check on this machine. Prototype
progress does not substitute for the rewrite's existing acceptance/performance work.

## Evidence in a handoff

Record the commit tested, exact commands, pass/fail results and what did not run
in [status.md](status.md). If a worktree was dirty, name the relevant uncommitted
changes rather than attributing results to a clean commit. Report a failed check
as failed, even when another check passes. Only tick a slice's behavioral outcome
after its promised checks pass; label partial work as an experiment or checkpoint.

Preserve reduced counterexamples when they reveal a parser, mapper or runtime
bug. Update expected behavior when an explicit design decision changes it, with
the reason and decision link in the same commit.
