# TypeScript and editor tooling

State: TypeScript 7.1-beta mapper/CLI/LSP probe and first paired flow-checking
profile built. Broader editor/flow acceptance remains open. Owns DX-01, DX-03,
DX-24 and tooling DX-26.

## Implemented boundary

The separate syntax package supplies source understanding for a
checking representation and authored span maps. The content mapper exposes those
to TypeScript. This is tooling; application compilation stays in compiler-next's
existing pipeline. The mapper does not implement refs or emit a second runtime.

Preserve identifiers, ordinary expressions and types verbatim where possible.
Generated nodes must not acquire fabricated authored declarations. Check both
reads and writes for refs and bindings. A diagnostic mapped near an expression
is not sufficient evidence that rename or completion edits are safe.

`projectForChecking()` is exported through `@memoized-dom/jsx-plus/checking`.
It imports `normalize()` directly, retaining standard TSX and exact copied-span
mappings without loading the production compiler facade. Protocol mappings are
verbatim tuples; generated syntax has no editable counterpart. TypeScript's
own `SpanMap` verifies an identifier maps exactly and a generated brace does not.

The primary TSX view keeps normal narrowing and editor identity. Compiler-owned
facts select regions checked through a supplemental TSX view with widened state
seeds and possible prop writes. Diagnostic directives delegate only those ranges;
the supplemental view checks them and ignores the complement. Its copied mappings
disable editor features, preventing duplicate rename/completion edits. Generated
insertions stay unmapped. See [checking flow](checking-flow.md) for the bounded
profile, coverage tests and unsupported-input fallback.

On a `JsxPlusError`, the projection returns its authored diagnostic plus an empty
unmapped module. This reports the failure rather than pretending the remaining
file was checked. Partial syntax recovery remains future work. Unexpected
internal failures are left to the host's mapper-failure handling.

The [research in dx.md](../dx.md#3-research-typescript-content-mappers) links the
protocol, permissions and mapping constraints. Use its exact-verbatim edit rule
and recheck the pinned version when advancing P3. Preserve a note of the actual
TypeScript/editor versions and permissions used by the probe.

## Existing files and planned work

| Path relative to repository root | State and role |
| --- | --- |
| `package.json` | Existing TypeScript version pin; repository checks stay on `bun check` |
| `packages/compiler-next/tests/reference/typescript.ts` | Existing independent reference lowering; do not reuse the new production lowering as its oracle |
| `packages/language-service/src/plugin.ts` | Existing TS6 plugin; the mapper needs its own integration plan |
| `wiki/compiler/typescript.md` | Existing API notes and compatibility limits |
| `packages/jsx-plus/src/source.ts` | Existing exact copied-span mappings for normalized TSX; generated syntax has no authored edit span |
| `packages/jsx-plus/src/checking/project.ts` | Paired TSX projection and authored parse diagnostics |
| `packages/jsx-plus/src/checking/protocol.ts` | Checking outputs, feature masks and diagnostic-directive tuples |
| `packages/jsx-plus/src/checking/flow/plan.ts` | Compiler-fact selection of state/prop insertions and dependent checking regions |
| `packages/jsx-plus/src/checking/flow/syntax.ts` | Index parents and include receiving declarations/opening elements in diagnostic routing |
| `packages/jsx-plus/src/checking/flow/render.ts` | Supplemental assembly, composed maps and complementary diagnostic routing |
| `packages/jsx-plus/tests/checking-projection.test.ts` | Coverage of delegated spans, overlap merging, unmapped scaffolding and lowering fallback |
| `packages/jsx-plus/src/checking/facts.ts` | Opt-in public compiler inspection and authored fact locations |
| `packages/jsx-plus/tests/checking-facts.test.ts` | Identity/provenance, mapping fidelity and lowering-coordinate tests |
| `packages/jsx-plus/src/mapper/server.ts` | JSON-RPC process, UTF-16 negotiation and independent cache lifetimes by project handle |
| `packages/jsx-plus/src/mapper/project.ts` | One latest exact filename/content checking result per open project |
| `packages/jsx-plus/tests/mapper-cache.test.ts` | Real task-board projections, reuse counts, edits, eviction, parse errors and project isolation |
| `packages/jsx-plus/package.json` | Private prototype mapper manifest and checking export; launches through Bun |
| `packages/jsx-plus/tests/checking.test.ts` | Projection/edit fidelity, lifecycle and actual TypeScript CLI checks |
| `packages/jsx-plus/tests/mapper-lsp.test.ts` | Actual LSP rename, authored Unicode diagnostic and incomplete/restore edit cycle |
| `packages/jsx-plus/tests/rpc.ts` | Test-only framed transport/process cleanup and UTF-16 position helpers |
| `packages/jsx-plus/examples/checking/App.auwla` | Valid typed-prop/ref example used by CLI and LSP checks |
| `packages/jsx-plus/examples/checking/TypeError.auwla` | Deliberate string-method error after an emoji |
| `packages/jsx-plus/examples/checking/tsconfig.json` | Local prototype registration and existing JSX type declarations |
| `packages/jsx-plus/examples/checking/tsconfig.error.json` | Selects the deliberate failure as its only authored file |

Prototype imports use the explicit working extension, for example
`./Counter.auwla`; registration is not a promise of extensionless resolution.
Formatting, highlighting and CSS support need separate plans for the whole grammar.

## Verified toolchain and transport

Verified on Windows with installed `typescript@7.1.0-beta`, package git head
`3e9236361fa97a9e6c685f4833ac457ae2d8c50a`, and `vscode-jsonrpc@9.0.2`.
The normalizer remains on yuku 0.19.0. Bun runs the mapper from this workspace;
the private manifest is not a published cross-runtime distribution contract.

The [upstream protocol](https://github.com/microsoft/typescript-go/pull/4712)
defines initialize/openProject/transform/closeProject over framed JSON-RPC.
The prototype negotiates UTF-16, stores open handles independently, rejects
closed handles and unknown options, and drops handle state on close. It adds
a [bounded transform cache](mapper-cache.md): one latest filename/content result
per project, replaced on edit and discarded on close or every reopen. There is
no dynamically discovered configuration. The real task-board sequence performs
five projections for seven requests, with no AST/edit history retained.

`vscode-jsonrpc/node` selects Node-compatible stream transport, supported by Bun;
it does not require the VS Code editor. The mapper talks to TypeScript. An IDE
needs a compatible TypeScript content-mapper integration; no other IDE or VS Code
extension activation has been verified by this headless probe.

From the repository root, this runs the pinned TypeScript CLI explicitly:

```text
bun node_modules/typescript/lib/tsc.js --project packages/jsx-plus/examples/checking/tsconfig.json --runExternalCode --pretty false
```

The valid example exits zero. Changing the project filename to
`tsconfig.error.json` reports the intended authored `TS2551` error and exits two.
Omitting mapper execution permission reports `TS18068`. This command exercises
the mapper host; routine repository type checking stays on `bun check`.

The installed beta's LSP binary starts with `--lsp --stdio`. The probe sets
`initializationOptions.runExternalCode: true`, sends `initialized` before opening
files and responds to capability registration. Passing `--runExternalCode` after
`--lsp` is rejected by this pinned binary's LSP flag parser; do not copy that CLI
ordering into an editor launch configuration. Editor trust/permission UX remains
unverified; the test records its actual headless initialization settings.

## First probe and acceptance examples

Use a tiny file with a typed prop, quoted text, a direct expression and a normally
declared ref. Include a deliberate wrong expression and an incomplete edit.

| ID | Evidence required |
| --- | --- |
| TOOL-01 | Built: CLI reports the authored error location; LSP checks the full UTF-16 range after an emoji |
| TOOL-02 | Built for the probe: actual LSP ref rename updates four uses and changing-state rename updates five; applying edits and rechecking yields no errors |
| TOOL-03 | Partial: real task-board member completion resolves and applies an exact authored insert/replace edit inside a parenthesized attribute, then rechecks. Auto-import and broader completion contexts remain open |
| TOOL-04 | Partial: Unicode ranges and a missing quote/restore cycle checked; preserving the rest of an incomplete file remains open |
| TOOL-05 | Hardened paired profile: 34 actual LSP targets pass, including receiving-type errors, generic helpers and deferred/immediate callbacks. Full flow acceptance remains open; see [checking flow](checking-flow.md) |
| TOOL-06 | Partial: exact unchanged input reuses the full result; real-example reuse/eviction/isolation counts pass. Incremental edits, measured latency and heap acceptance remain open |

Start with TOOL-01 and TOOL-02 during P2/P3; expand as grammar grows. Keep failing
edits as regression fixtures when the parser or mapping strategy changes.

## Open questions

Published packaging, editor extension registration, inferred projects,
declaration output, incremental invalidation beyond exact input, multi-module editing and the editor
version matrix remain open. Broader completion, auto-import, formatting, cross-file
rename and broader generated-region diagnostics need their own evidence.

TOOL-05 remains open beyond the 34-case profile: ref writes, complete replay
proofs, contextual typing, aliases, live imports and lowering maps need more
evidence. Selected ranges receive native supplemental checking rather than blanket
error suppression. The primary view still supplies editor features, so flow-aware
hover/completion behavior requires separate work. A custom extension also does
not automatically inherit a TSX formatter or CSS tooling.

The [checking-flow catalog](checking-flow.md) and strict LSP gate now pass all
34 targets. Receiving declarations/opening elements are included because native
assignability errors can begin outside the selected expression. Typed identity
calls validate copied seeds before widening; generated helpers have no editable
mapping. The ordinary mapper uses the compiler's read-only public facts;
it stops before compiler planning/emission and does not emit application code.
