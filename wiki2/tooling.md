# TypeScript and editor tooling

State: content mappers are the user direction; implementation and version matrix
are open. Owns DX-01, DX-03, DX-24 and the tooling part of DX-26.

## Proposed boundary

Compiler-next's extended parse support supplies source understanding for a
checking representation and authored span maps. The content mapper exposes those
to TypeScript. This is tooling; application compilation stays in compiler-next's
existing pipeline. The mapper does not implement refs or emit a second runtime.

Preserve identifiers, ordinary expressions and types verbatim where possible.
Generated nodes must not acquire fabricated authored declarations. Check both
reads and writes for refs and bindings. A diagnostic mapped near an expression
is not sufficient evidence that rename or completion edits are safe.

The [research in dx.md](../dx.md#3-research-typescript-content-mappers) links the
protocol, permissions and mapping constraints. Use its exact-verbatim edit rule
and recheck the pinned version when starting P3. Preserve a note of the actual
TypeScript/editor versions and permissions used by the probe.

## Existing files and planned work

| Path relative to repository root | State and role |
| --- | --- |
| `package.json` | Existing TypeScript version pin; repository checks stay on `bun check` |
| `packages/compiler-next/tests/reference/typescript.ts` | Existing independent reference lowering; do not reuse the new production lowering as its oracle |
| `packages/language-service/src/plugin.ts` | Existing TS6 plugin; the mapper needs its own integration plan |
| `wiki/compiler/typescript.md` | Existing API notes and compatibility limits |
| `packages/language-service/src/content-mapper/checking/` | **Planned** virtual source and mappings; tooling only, exact placement provisional |
| `packages/language-service/src/content-mapper/` | **Planned** protocol, configuration, lifecycle and cache; packaging open |

Prototype imports use the explicit working extension, for example
`./Counter.auwla`; registration is not a promise of extensionless resolution.
Formatting, highlighting and CSS support need separate plans for the whole grammar.

## First probe and acceptance examples

Use a tiny file with a typed prop, quoted text, a direct expression and a normally
declared ref. Include a deliberate wrong expression and an incomplete edit.

| ID | Evidence required |
| --- | --- |
| TOOL-01 | CLI checks the authored file and reports a deliberate type error at its exact authored range |
| TOOL-02 | Rename preserves valid source across a declaration, direct child expression, ref prop and handler |
| TOOL-03 | Completion insertion and auto-import edits stay in safe mapped spans |
| TOOL-04 | Unicode offsets and missing quotes/tags recover without losing the rest of the file |
| TOOL-05 | Branch/row locals preserve scope; deferred callbacks receive correct types rather than unsafe mount-time narrowing |
| TOOL-06 | A repeat edit reuses appropriate work; record observed latency and memory on this machine without claiming a general performance result |

Start with TOOL-01 and TOOL-02 during P2/P3; expand as grammar grows. Keep failing
edits as regression fixtures when the parser or mapping strategy changes.

## Open questions

Mapper packaging, extension registration, inferred projects, declaration output,
transport disposal, caching/invalidation, diagnostics in generated scaffolding,
and supported editor versions. Resolve the subset needed by each slice; a custom
extension does not automatically inherit a TSX formatter or CSS tooling.
