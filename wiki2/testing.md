# Verification and evidence

State: baseline and separate-package extended-source checks available. Full
grammar, tooling, module-graph and delivery acceptance remain open.

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

The actual extended-source suite is separate:

```text
bun check -p packages/jsx-plus/tsconfig.json
bun run --cwd packages/jsx-plus test
```

It checks authored views/errors and compiles extended source through the package's
public-API facade into compiler-next, executing both optimization modes. Code
stays in that package; existing compiler-next/runtime/data sources are unchanged.

`tests/host.test.ts` also evaluates normalized source using Bun's ordinary TSX
transpiler and a plain JSX value factory. This verifies native generator
suspension/resumption and async values independently of reactive compilation.
It does not establish compiler-next's full async/generator runtime acceptance.
Compiled UI tests separately exercise object-valued branch children and ternaries
ending in markup in both compiler modes.

`tests/checking.test.ts` and `tests/mapper-lsp.test.ts` run the installed pinned
TypeScript 7.1-beta CLI and language server with the real mapper process. They
check exact copied-span/edit fidelity, project close/reopen/isolation, CLI mapper
permission, authored Unicode diagnostics and ref rename edits applied back to
source. A missing-quote edit reports its authored location and a valid replacement
clears it. See [tooling](tooling.md) for verified launch/permission settings and
the limitations of this first TSX projection. This explicit mapper-host probe is
separate from ordinary package type checking with `bun check`.

The checking-flow catalog has a separate target gate, run from the package:

```text
bun run tests/probe-flow.ts --strict
```

This command currently **fails with exit one on four targets**. Its default
observation mode prints the same mismatches but is not an acceptance check.
`checking-flow.test.ts` asserts the seven matching ref/scope/ordinary-flow cases
and reports the remaining gaps; a passing package suite does not mean TOOL-05 is
complete. `compile.test.ts` independently demonstrates that guarded union children
and guarded derivations outside markup replay correctly in both compiler modes.
The target contract, sources and proposed next boundary are mapped in
[checking-flow.md](checking-flow.md).

Acceptance IDs are owned by [syntax.md](syntax.md), [refs.md](refs.md) and
[tooling.md](tooling.md); later features add theirs on their concept page.
Actual and planned prototype files are mapped in [architecture.md](architecture.md).
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
