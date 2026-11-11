# Syntax model and conformance view

0.1-draft, revision 4. Owns G-SOURCE and A-RANGE/A-NODES/A-NORMALIZE.

## Purpose (A-NODES)

The added child forms need source-aware syntax before they can normalize into
compiler-next's existing JSX/host AST. This document defines a small serialized
view for comparing that syntax. It does not introduce a new semantic graph or
replace yuku's JavaScript AST. Production internal classes may differ if their
view and normalization satisfy this contract.

The new constructs are expression children without a JSX container and direct
conditional children, plus parenthesized attribute values. Those values normalize
to existing JSX attribute expressions; no additional attribute AST is defined.
A ref is an ordinary JSX attribute expression, never a new
kind of declaration.

## Locations (A-RANGE)

Every view node has `range: [start, end]`, meaning `[start, end)` in UTF-16 code
units of the original complete source. A parent contains its children; siblings
are ordered and do not overlap. Trivia and separators need not become nodes,
but their source positions are not discarded. Ranges are never measured in a
normalized string with different offsets.

An expression's `source` is exactly `sourceFile.slice(start, end)`. A string's
range includes its quotes, so renaming/mapping does not confuse decoded text with
authored spelling. Element ranges include their complete tags and children.
Conditional blocks include their braces; conditional tests exclude parentheses.

Offsets are authoritative. A line/column is derived from the same source using
the conventions in [diagnostics.md](diagnostics.md). `"😀"` occupies four UTF-16
units, even though it has three Unicode code points.

## Node shapes

```ts
type Range = [number, number];

type SyntaxView = {
  specVersion: "0.1-draft";
  root: Child;
};

type Child = Element | Fragment | Expression | Conditional;

type Element = {
  kind: "element";
  range: Range;
  name: string;
  children: Child[];
};

type Fragment = {
  kind: "fragment";
  range: Range;
  children: Child[];
};

type Expression = {
  kind: "expression";
  range: Range;
  source: string;
};

type ChildBlock = {
  kind: "block";
  range: Range;
  children: Child[];
};

type Conditional = {
  kind: "if";
  range: Range;
  test: Expression;
  consequent: ChildBlock;
  alternate: ChildBlock | Conditional | null;
};
```

An expression containing nested markup remains an expression in this small view;
the production host AST MUST still represent its nested markup and scopes. The
view's raw span is not permission to avoid parsing JavaScript. Attributes also
remain in the production JSX AST with their original expressions, order and ranges;
this core view omits them rather than specifying a second attribute AST.

The JSON form is defined in [ast.schema.json](ast.schema.json). Generated names,
resolver bindings, runtime IDs and optimization decisions do not appear in it.

## Normalization obligations (A-NORMALIZE)

- Normalize before compiler-next resolves bindings. Every authored reference
  reaches its normal resolver scope and subsequent graph/plan stages.
- Direct expression children become normal expression sites; a quoted child
  stays a host string expression rather than being reinterpreted as JSX raw text.
- `prop=(expression)` becomes `prop={(expression)}`. The original parentheses
  and expression keep exact copied spans; inserted JSX braces stay unmapped.
- `prop=name` becomes `prop={name}` with the identifier's exact copied spelling
  and range. Inserted braces stay unmapped; no handler wrapper is introduced.
- Conditional bodies become existing conditional/fragment/child machinery with
  the semantics in [semantics.md](semantics.md). No new branch runtime is defined.
- Preserve native operations and authored evaluation order. Do not implement a
  small evaluator that only recognizes familiar expression spellings.
- Keep authored source and its syntax view intact. Normalized nodes are fresh
  nodes with source mappings; later compiler analysis sees a consistent snapshot.
- Generated scaffolding has no fabricated authored declaration. Source maps for
  production diagnostics and span mappings for TypeScript editing are separate.
- Existing `ref={input}` reaches the existing ref feature with the same target
  binding. There is no ref-lowering reimplementation in this syntax extension.

Recovery-node shape is an implementation/tooling experiment for P2/P3. Until
specified, recovery output cannot claim exact parser conformance for invalid input.
