# Linking: several modules

**Folder:** `link/` (native module boundary built; package artifacts pending).

## What it does

Compiles a module graph together, so a component, state or source imported from
another file behaves as if it were local.

Phase 9 starts with independent reference cases, then fixes the uncovered
compiler boundaries. Existing component, state and source machinery remains
responsible for reactivity. Linking preserves native ESM bindings and namespace
objects; it does not introduce a second state model.

## Files

| File | What it owns |
| --- | --- |
| `core/resolve/exports.ts` | Cached value-export identities: live bindings, captured default expressions, namespaces, erased types, star conflicts and cycles |
| `core/resolve/exports.test.ts` | Independent export-fact checks, including a default capture conflicting with its original live binding |
| `core/resolve/imports.ts` | Existing module-path resolver, extension/index probing and caller-provided resolution |
| `link/modules.ts` | Native public re-export boundaries that exclude compiler-only exports; collision-free private siblings and original diagnostic provenance |
| `link/captured-plan.ts` | One value cell per captured default expression, shared by importing bindings and namespaces |
| `link/captured-dom.ts` | Native default evaluation and contextual naming, with existing shared mutation roots for the captured value |
| `features/state/shared-plan.ts` | Shared binding readers and the versions a compiled namespace can observe |
| `features/state/shared-dom.ts` | Namespace version observation and guarded mutation inputs, preserving the native receiver and avoiding uninitialized export reads |
| `tests/cases/linking.test.ts` | Reference and optimized/general comparisons for live/default exports, namespaces, cycles, collisions, components and readiness |
| `tests/cases/linking.packages.test.ts` | Source-graph oracle for separate package compilation: forwarded status/payload use, returned sources, shared package state and retained component state |

## Rules

- One `yuku-analyzer` `Analyzer` holds every file of the build.
  `binding.definition()` and `module.resolveExport()` follow imports and re-exports;
  the resolver option maps Vite aliases.
- Each module gets a **summary**: its exported components, state, sources and
  helpers, and the graph facts other modules need. A module reads other modules
  only through summaries.
- **Module state** (a top-level binding that is written) is state shared by every
  component that reads it. The same classification rules apply
  (`state-and-derived.md`).
- When a file changes, only that file and its dependents are compiled again
  (`module.dependents`). This incremental API is still pending; current calls
  compile the supplied graph together.

## Native module boundary

`export { count as default }` forwards a live binding. `export default count`
captures a separate value at that statement. The analyzer currently follows both
to `count`; the value-export index preserves the distinction through named and
star forwarding. Default literals and anonymous expressions remain runtime
exports even when they have no analyzer binding. Type-only exports are erased.
Conflicting star bindings are absent from namespaces; an explicit export wins.
Indexes are built once per immutable analyzer module, rather than rescanning
every export for each imported binding. Incomplete cyclic queries are not cached.

A compiled namespace conservatively observes the shared exports of its target
module. Observation records versions through the existing runtime collector and
does not read the export values. The original namespace object is still the
receiver of member calls, including computed members and methods using `this`.
Its identity, keys, descriptors and host-native prototype are retained. Before a
cyclic producer has executed, the observer's hoisted key slot is undefined and
cannot create a temporal-dead-zone error of its own.

Opaque calls through a namespace observe separate initialized data roots through
these helpers, rather than enumerating the namespace. Each read keeps native
value identity; allocating a fresh array of values would falsely report every
unchanged call as a replacement. Hoisted readiness flags guard cycle-time reads.
Ordinary namespace reads record versions without requesting these values.

A captured default gets its own watched value, so object mutation remains live
after its original variable is replaced. Imports use the existing mutation
planner and observer to notify actual data roots, without a mutable import clock.
The captured expression still evaluates once at its native export position.
Anonymous default expressions retain the native contextual name `default`.
Callable identity proofs remain separate from reactive binding forwarding.

Compiler reader/observer exports cannot appear in authored namespace reflection.
In graphs that consume compiled namespaces, modules needing private exports get
an implementation sibling and a native public re-export facade at their original
path. Authored imports keep that public path; generated helper imports reach the
implementation. Private paths avoid every authored/generated path. Public
facades contain no authored setup and do not duplicate module instances. They
can be removed by ordinary bundling. Named-import graphs without namespace use
keep their existing output shape.

The reference uses its own native module loading and dependency snapshots, with
no production linking helpers. Export specifiers remain native identifiers.
During static import evaluation it defers namespace descriptor snapshots until
the modules have initialized, before mounting or handlers. This permits a cycle
to call a hoisted export while another export is still uninitialized. Native
namespace detection is test-only (`node:util`); prototype assertions use an
uncompiled native-module control because Bun and Node expose different prototypes.

## Cases and validation

The 27 comparisons in `tests/cases/linking.test.ts` establish the first slice:
named/star/default forwarding, captured default values, direct/re-exported and
computed namespaces, method receivers, native namespace shape and identity,
diamond/cyclic graphs, hoisted calls before initialization, private-name/path
collisions, retained component state and source readiness without duplicate
requests, captured-object edits after replacement, opaque namespace mutations
and anonymous default naming. Every comparison has an explicit expectation and runs with optimizer
passes enabled and disabled. Existing case expectations remain unchanged.

Original star-export edges remain in public facades, so the native loader still
handles unknown external names and conflicts. AST origin metadata distinguishes
generated helper imports from authored imports: a forwarded public export with
a helper-like name must never be redirected to compiler metadata.

Eleven resolver checks independently cover live versus captured defaults,
anonymous runtime values, type erasure, conflicting exports, cyclic diamonds,
namespace forwarding, unresolved packages and immutable authored syntax. The
cached-conflict check preserves an ambiguity through another star barrel. The
24-level repeated-star diamond guards against expanding every possible path;
type-only namespace imports do not request runtime observation or facades.

## Separate package contract: reference foundation

Four source-graph comparisons establish behavior that a separately compiled
package must preserve. Status-only parameters keep their source handle and run
during initial loading and refresh. Mixed status/payload parameters also keep
the handle, but the call waits for payload readiness. Forwarded source factories
retain source identity, replacement and request counts. Package state remains
one shared owner while each component instance keeps its own local state.

The reference links its own untouched inputs and finishes parameter-flow proofs
for every file before rewriting any of them. It uses neither compiler summaries
nor compiler linking code. The same explicit expectations will also apply to
artifact-linked output; these cases currently exercise source-graph compilation.

The artifact implementation must compile package code once and let consumers
analyze only their own sources. Its metadata must be serializable data with an
explicit compatibility version, exported value identities, parameter-relative
source use and conservative unknown behavior. Native public exports must exclude
compiler-only readers for consumers outside the build. Do not serialize the
authored AST, copy package sources into the application build, or rebuild the
old compiler's mutable linking context. Runtime paths and semantic metadata must
identify the same package instance; incomplete information retains opaque checks.

## Inputs and outputs

- Input: the caller's source graph and `resolveImport`, using the existing
  single analyzer and shared semantic graph.
- Output: JavaScript at every supplied public path, plus private implementation
  siblings only when a namespace boundary needs them. Diagnostic paths/sources
  still identify the authored module.

## Where to add things

Add value-export facts to the shared resolver, source-graph boundaries to
`link/`, and cases to this page's case file. Keep state/source behavior in its
existing feature. `pipeline.ts` alone orders parsing, resolution, graph/planning,
optimization, emission, namespace linking and printing.

## Remaining Phase 9 work

- Separate package compilation and a serializable, versioned semantic artifact.
  The first source-graph reference cases for status/payload parameter forwarding,
  components and shared package state pass. Next, make these same observations
  through a JSON-round-tripped artifact with package sources absent. Audit the
  old compiler's useful requirements; do not transplant its mutable linker.
- Public package entry boundaries must hide private exports for external
  consumers even when the package source has no namespace importer. Current
  boundary selection only covers namespaces known in the supplied graph.
- Incremental invalidation, dynamic-import combinations, external/unknown star
  exports and broader cyclic graphs need further coverage.
- `bench/linker` and `bench/package-compilation` still target the old compiler's
  APIs. Their rewrite correctness gates and VM measurements remain Phase 9 exit
  work, not results established by the first slice.

## Not designed yet

These are ported from `packages/compiler` once the core works, each with its own
page:

- routes and `$routed`;
- server functions and their client stubs;
- server pages;
- package compilation (`experimentalCompilePackage`).
