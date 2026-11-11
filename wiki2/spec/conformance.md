# Conformance and fixtures

0.1-draft, revision 1. Owns C-LEVELS/C-FIXTURES/C-EVIDENCE.

## Levels (C-LEVELS)

| Level | Pass condition | Current implementation status |
| --- | --- | --- |
| Fixture integrity | Catalog IDs/rules are valid; expected trees/ranges/source slices are internally consistent; equivalents parse | Check script provided |
| Host baseline | Existing host parser has the specified continuation shapes; existing JSX equivalents produce explicitly expected text/update results | Check script provided |
| Extended parse | The syntax package produces the expected view with exact ranges | Current 6 fixtures pass; broader grammar acceptance open |
| Extended diagnostics | New syntax produces the expected primary code/severity/range | Current 5 fixtures pass; broader recovery open |
| Extended behavior | Extended source matches explicit expectations through updates/disposal | Current 9 programs pass in optimized/general modes; lifecycle coverage remains |
| Tooling | Real mapper diagnostics/rename/completion satisfy the authored-span checks | Initial CLI/LSP diagnostic and ref-rename probe passes; four checking-flow targets fail, and completion/editor registration remain open |
| Delivery | Extended source preserves existing SSR/adoption and lifecycle behavior | Not implemented; no pass claim |

A fixture check is not a parser test. Passing a JSX equivalent establishes the
expected behavior of the existing baseline, not support for the extended source.
Future runners MUST label these results separately and MUST fail when a claimed
implementation level has unsupported/skipped fixtures.

A partial prototype may report individual fixture IDs as implemented and list
the rest as pending. It MUST NOT describe that subset as conformance to the whole
core level. Expand coverage for lexical ambiguity, scopes and lifecycle cases as
the implementation grows; the first catalog is not exhaustive.

## Catalog (C-FIXTURES)

[cases.json](cases.json) is the initial single-file catalog. Each case has a stable
`id`, `level`, `rules` and `source`. The levels have these extra fields:

- `parse`: `expected` is a syntax view under [ast.schema.json](ast.schema.json).
- `diagnostics`: `expected` is the primary diagnostic's code/severity/range.
- `host`: `source` is ordinary host code and `expected` gives top-level statement
  expression kinds from the existing parser.
- `behavior`: `source` is the extended program, `jsxEquivalent` the separately
  authored current-JSX program, and `expected` gives text snapshots plus optional
  clicks. An optional `ref` identifies a selector/export to check node identity
  and clearing on unmount.

Fixtures are reviewed examples, not generated from a new JSX+ parser. Future
test runners may split them into source/expectation files without changing IDs or
the contracts. Full parser assertions must retain every range; attribute and
scope correctness also need behavior/tooling cases because the small syntax view
deliberately omits attribute internals.

## Running the checks available now (C-EVIDENCE)

From the repository root:

```text
bun run wiki2/spec/check.ts
bun check -p wiki2/spec/tsconfig.json
```

The checker validates the catalog and its source/range invariants, probes host
continuation with the parser resolved from compiler-next, and runs the current
JSX equivalents through compiler-next and the runtime in memory. It writes no
compiled fixture files and adds no production parser. It checks the limited view
shape directly; it is not a general-purpose JSON Schema validator.

The separate package now runs extended-source checks:

```text
bun check -p packages/jsx-plus/tsconfig.json
bun run --cwd packages/jsx-plus test
```

Those commands cover the current parse/error fixtures and behavior programs plus
lexical/mapping regressions. The baseline checker above still deliberately labels
extended execution NOT RUN because it does not invoke that package. Actual
editor registration, module-graph and delivery integration remain future work. The
package's tooling tests additionally run actual TypeScript CLI/LSP requests. See
[status.md](../status.md) for current evidence and limitations.

Rendered expectations concern observable text/node behavior, not compiler helper
names, anchor comments or a particular generated string. A changing behavior
expectation requires an explained spec change. The baseline and future extended
execution use optimized/general modes where applicable; SSR and mapper levels
are separately reported, not inferred from browser output.

Stable rule IDs link each example to grammar/semantics. Preserve reduced failures
and update the changelog when changing their meaning. Existing compiler tests
remain the source of truth for inherited features and their known limits.
