# JSX+ language extension specification

Version: **0.1-draft**, revision **1**. Initial core profile. Created: 2026-11-11.
Implementation: **first slice built** in the separate `packages/jsx-plus` package.
It normalizes the tested subset to standard TSX and calls compiler-next's public
API. Compiler-next continues to receive ordinary TSX; its grammar stays unchanged.

JSX+ extends Auwla's markup authoring while retaining JavaScript/TypeScript and
compiler-next's existing semantics. It adds quoted text, direct expression
children and direct conditional children. Refs, ordinary event props, list
reconciliation, state, readiness and ownership already exist and are reused.

## Documents and authority

| Document | Defines | Status |
| --- | --- | --- |
| [grammar.md](grammar.md) | Lexical contexts, child boundaries, grammar and early syntax errors | Draft core contract |
| [ast.md](ast.md) | Added syntax forms, source ranges and the conformance view | Draft core contract |
| [ast.schema.json](ast.schema.json) | Serialized conformance-view shape | Draft core contract |
| [semantics.md](semantics.md) | Evaluation, child production and normalization obligations | Draft core contract |
| [diagnostics.md](diagnostics.md) | Planned syntax diagnostics and authored locations | Draft core contract |
| [conformance.md](conformance.md) | Fixture format, comparison levels and what has actually been checked | Draft core contract |
| [cases.json](cases.json) | Concrete parse, error, boundary and behavior examples | Draft fixtures |
| [check.ts](check.ts) | Fixture-integrity checks, host-parser probes and existing-JSX behavior checks | Verification tool; not a JSX+ parser |
| [CHANGELOG.md](CHANGELOG.md) | Changes between draft revisions | History |

The user's latest instructions and [existing ground rules](../../wiki/rules.md)
take precedence. [Decisions](../decisions.md) distinguish accepted direction from
provisional design. `MUST` and `MUST NOT` describe obligations for implementing
this draft; `SHOULD` is a recommendation and `MAY` a permitted choice. These words
do not turn provisional choices into user-approved decisions.

The spec is the single home for precise language rules. [syntax.md](../syntax.md)
maps their implementation and open investigations. [dx.md](../../dx.md) remains
the broader design discussion. A plan or an example does not override a rule.

## Accepted direction and draft choices

Accepted: quoted text, direct expression/control-flow children, normal declared
refs through the existing ref prop, and the existing compiler-next pipeline.

Revision 1 provisionally chooses JavaScript expression continuation/ASI, explicit
separators where expressions could join, JS string escapes without JSX text
normalization, and block bodies for direct `if`. These are concrete choices to
test and revise, not settled decisions about every future language construct.

`.auwla` is the working extension used to label fixtures. File extension and
packaging remain open. Existing `.js`, `.ts`, `.jsx` and `.tsx` retain their syntax.

## Backend authoring direction (planned)

`.auwla` may also author pure backend JavaScript/TypeScript, importing Express,
database clients and other ordinary backend packages. Project configuration will
identify the backend files and/or folders. Such code is nonreactive and preserves
ordinary backend execution; the file extension does not make it UI code.

This extends authoring within the same compiler-next toolchain. The config
surface and `.auwla` backend loading are not implemented or specified in detail
yet. Isomorphic support is future work. The core markup profile below does not
impose reactive UI semantics on configured backend code.

## Core profile

Included: existing elements/fragments and ordinary JSX attributes, quoted string
and template children, arbitrary host expressions (including `.map()` and
ternaries), direct `if`/`else if`/`else` child blocks, comments and existing refs.

The host language handles operators, types, functions and expressions; this spec
does not reimplement them. At a conflicting markup boundary an expression can be
parenthesized, as detailed in [grammar.md](grammar.md).

Direct loops, declarations inside markup child blocks, abrupt statements inside
those blocks, lazy `@event` expressions, modifiers, bindings, class shorthand and
special CSS blocks are later profiles/design questions. Their syntax and behavior
are not silently inferred from this core. Ordinary JavaScript declarations,
loops and functions outside markup, or inside a normal function expression, keep
working; an ordinary expression is not rejected for calling unknown code.

## Compiler continuity

```text
extended syntax -> separate packages/jsx-plus normalizer -> standard TSX
standard TSX / existing syntax
  -> compiler-next public API and existing parse stage
  -> resolve -> graph -> plan -> optimize -> emit
  -> existing runtime / DOM / SSR
```

The mapper derives a checking projection from the same syntax understanding.
That is TypeScript tooling, not another production compiler. Normalization MUST
preserve binding scopes, evaluation order, native operations and authored ranges.
It MUST NOT create a new state model or rebuild the ref implementation.
DX-31 places that normalization in its own package rather than inside existing
compiler-next source folders.

## How the draft evolves

Give rules and fixtures stable IDs. Change a provisional rule when a concrete
counterexample improves the design; update grammar, semantics, fixtures and the
changelog together. Surface a change to accepted authoring behavior and record
its reason in [decisions.md](../decisions.md). Unresolved questions remain explicit.

Research basis: JASX's spec organization, inspected at commit
[`d055ed855f1debcb1782feb602172756308dde58`](https://github.com/snrraptopack/jasx/tree/d055ed855f1debcb1782feb602172756308dde58/jasx-spec).
Its separate grammar, syntax-tree, semantics, diagnostics and conformance
documents informed this structure. Its Java grammar, target model and runtime
rules are not imported into Auwla.
