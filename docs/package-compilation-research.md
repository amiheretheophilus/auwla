# Separate package compilation and reactive linking

Status: active compiler work, started 2026-10-16. Request-state and payload
relationships now link across local functions, imports, aliases, and re-exports,
including helpers that use both relationships. No reusable package artifact
format, package-build command, or compatibility contract has been selected or
implemented. Authoring examples involving an installed precompiled package
still describe intended behavior.

## Motivation

Optional utilities should be ordinary functions, not compiler-recognized names.
A helper that reads `$track(source).pending` should preserve its source and
request-state dependencies whether it is local, imported from another application
module, or imported from an installed package. Aliases and wrappers should not
change that behavior.

The broader opportunity is to compile a package independently, cache the reusable
result, and link its reactive behavior into consuming applications. This could
support helpers and eventually component libraries without repeatedly analyzing
all their original source or adding package-specific compiler exceptions.

The recommended direction is **partial package compilation followed by
application linking**, not publishing today's final standalone JavaScript and
assuming it can be connected afterward.

Here, compiled means compiler-processed library code and associated semantic
information; it does not mean machine code or a new rendering target. The scope
of this discussion is the web compiler and its browser/server delivery paths.

## Verified findings in the current compiler

Small in-memory experiments against the existing built compiler established the
following gaps. These were compilation probes, not runtime or performance tests.

### Request-state-only helpers now preserve request identity

Given a linked helper:

```js
import { $track } from '@memoized-dom/data';

export function busy(source) {
  return $track(source).pending;
}
```

And a component binding `const waiting = busy(stories)`, the function summary
now records `parameterSourceReads: [{ index: 0, path: [] }]`. The linker composes
that symbolic relationship through wrappers and re-exports, keeps `stories` as
the request holder, and attaches the derived scalar to the component's existing
source subscription. The helper expression is replayed in the subscribed DOM
entity, so pending-to-settled changes update in place without rerunning or
replacing the component.

Property paths are retained too. A helper reading
`$track(options.source).pending` records argument zero at `['source']`, and a
caller passing `{ source: stories }` maps that relationship back to `stories`.
This behavior comes from function summaries, not helper-name recognition.

### Direct derived request state is no longer payload-gated

`const waiting = $track(stories).pending` evaluates against the holder before
the first payload and replays through request-state subscriptions. It no longer
becomes `deriveResolvedValues([stories], ...)`.

### Mixed request-state and payload helpers preserve authored control flow

A helper may inspect the holder and then consume its payload:

```js
export function describe(source) {
  return $track(source).pending
    ? 'Loading'
    : `${source.length} stories`;
}
```

Its summary records both `parameterSourceReads` and `parameterPayloadReads`.
The call boundary preserves the holder so the pending branch is available
immediately and participates in the existing request-state subscription. Inside
the helper, only the proven payload use is lowered to a materializing read. Once
the request settles, the same derived DOM entity replays the helper and reaches
the payload branch; the component itself does not rerun and its DOM node is not
replaced.

This preserves the helper's authored control flow. It does not make every
unconditional payload access safe: a helper that reads `source.length` while the
source is still pending can still suspend or throw according to the surrounding
boundary. The compiler does not invent a loading branch the author did not write.

### Component emission depends on consuming code

The following component produces different output when compiled alone and when
compiled with a consuming component that supplies a number:

```jsx
export function Badge({ value }) {
  return <b>{value}</b>;
}
```

In the probe, standalone compilation treated `value` as a rendering callback;
application-linked compilation emitted a text node. The existing linker supplies
prop usage and source information that influences final component emission.

Freezing the current standalone output would freeze decisions that can require
application context.

### Browser and server state lowering differ

A separate probe compiling exported mutable module state with and without
`moduleStateCells` produced ordinary browser bindings versus server state-cell
operations. A browser artifact cannot simply bypass request-owned state lowering
when reused for SSR.

### Existing foundations and boundaries

- [Function metadata and the module linker](../packages/compiler/src/linker.ts)
  already carry cross-module effects and propagate summaries until stable.
- [Internal module manifests](../packages/compiler/src/linking/model.ts) and
  [component manifests](../packages/compiler/src/components/manifest.ts) retain
  more facts than the currently exposed compilation metadata. That public
  metadata is not a complete reusable package format.
- [Source acceptance](../packages/vite/src/paths.ts) currently excludes files
  under `node_modules`; package artifact discovery/consumption is absent.
- [Transparent read analysis](../packages/compiler/src/analysis/transparent-reads.ts)
  currently includes an `optimistic()` source-field exception tied to
  `@memoized-dom/utils`. A sufficiently expressive general contract should
  eventually replace that exception, not add more names beside it.

## External research

These are architectural precedents, not evidence that arbitrary JavaScript
reactivity can always be inferred.

- **Angular partial compilation:** distributed libraries retain portable partial
  declarations, and the application linker finishes compilation. Fully compiled
  private instructions have tighter compiler-version coupling. Angular also
  documents linker caching and version compatibility requirements.
  [Library compilation and linking](https://angular.dev/tools/libraries/creating-libraries#building-libraries-with-ivy),
  [package format](https://angular.dev/tools/libraries/angular-package-format#partial-compilation).
- **LLVM ThinLTO:** independently compiled modules carry compact summaries;
  linking combines those summaries, with selected cross-module transformations
  performed later. The useful lesson is separating reusable analysis from final
  context-dependent work, not adopting LLVM or emitting native code.
  [ThinLTO architecture](https://clang.llvm.org/docs/ThinLTO.html#introduction).
- **Svelte packaging:** reusable components are preprocessed and TypeScript is
  transpiled; framework-aware package entry points let consuming tooling process
  them. Shipping framework-aware source is another viable boundary, though it
  does not provide the same reuse of completed package analysis.
  [Packaging](https://svelte.dev/docs/kit/packaging).

## Proposed compilation boundary

### 1. Package compilation: preserve reusable meaning

Analyze a package's modules and emit JavaScript plus dependency/effect summaries
where those suffice. Retain an intermediate representation or other deferred
lowering information where final code depends on application usage. The exact
representation remains undecided; serializing today's internal AST or dumping
the current public metadata is not an established solution.

The information needs to distinguish:

- Argument-relative payload reads and request-state reads, including property
  paths such as `options.source` and collections of sources.
- Source identity requirements and returned-source/controller provenance.
- Captured module-state reads and parameter-relative mutations.
- Immediate evaluation, deferred callbacks, and returned closures.
- Stable setup/resource creation versus calculations that may be recomputed.
- Component props, slots, callback usage, and unresolved consumer-dependent facts.
- Unknown effects that prevent a safe automatic transformation.

Relationships must be symbolic: for example, "result reads pending state through
argument zero," not "subscribe to the application's variable named stories."
Summaries describe dependencies; they are not live subscriptions.

A mixed helper that inspects request state and reads its payload needs both
behaviors preserved. A single "reactive function" or "preserve all arguments"
flag cannot express that correctly.

### 2. Application linking: connect actual sources and owners

Resolve imported exports, compose their summaries through aliases/wrappers, and
bind their parameter-relative relationships to the application's actual values.

Intended usage, with the `busy` implementation above:

```jsx
import { busy as waitingFor } from 'some-package';

export function Stories() {
  const stories = $fetch('/api/stories');
  const waiting = waitingFor(stories);

  return <button disabled={waiting}>Continue</button>;
}
```

The linker should preserve `stories` as a source at this call, evaluate request
state before the first payload, and attach updates to the consuming component's
existing subscription and cleanup machinery. No registration, decorator,
additional author-facing type import, or helper/package-name whitelist should
be necessary. The same rule must apply to local and application-module helpers.

Framework primitives such as `$track` still need defined compiler semantics;
ordinary functions that compose those primitives should inherit the relevant
behavior through analysis, not become additional primitives.

### 3. Final emission: finish context-dependent decisions

Finalize source subscriptions, invalidation targets, component prop rendering,
browser/server lowering, and application-specific optimizations after linking.
Preserve existing ownership, disposal, request isolation, and delivery behavior.
This proposal does not require a new runtime dependency-tracking system.

## Constraints and unresolved decisions

### Cache package analysis separately from linked output

"Compile once" means once per compatible input/configuration, not forever.
Package artifacts can be reusable across applications; application-specialized
output may differ and needs a separate cache key.

Validity must account for source/artifact content, compiler and format
compatibility, relevant options, and resolved dependency identities. Workspace
edits, patched dependencies, peer dependency resolution, and browser/server entry
conditions must not silently reuse stale facts. Published metadata must match the
JavaScript it describes after bundling/minification.

No build-time or bundle-size improvement has been benchmarked for this proposal.

### Reads, actions, and setup have different lifetimes

`busy(source)` may be a recomputable state read; `refresh(source)` starts work.
Mutations, callback registration, subscriptions, and controller creation must not
be automatically repeated as if they were pure derived values. Deferred callbacks
must not be mistaken for actions executed during the enclosing helper call.

### SSR, identity, and security must survive linking

Keep server module state request-owned. Resolve a single intended runtime
instance, preserve ESM live bindings and side-effect order, and avoid state-key
collisions between distinct installed package instances. Do not bake a publisher's
absolute paths or an application's component placements into reusable identities.
Preserve server-only code boundaries; package linking must not expose service
implementations or server function bodies in browser output.

### Work with Vite rather than only one compilation path

Dependency prebundling is development-only, while SSR dependencies are normally
externalized. Artifact discovery and lowering must cooperate with both, including
workspace packages, HMR, conditional exports, and production builds. Preserve
tree shaking and lazy chunk boundaries rather than flattening every dependency
into the application graph.
[Dependency prebundling](https://vite.dev/guide/dep-pre-bundling),
[SSR externalization](https://vite.dev/guide/ssr#ssr-externals).

### Do not automatically transform the entire npm ecosystem

Distinguish framework-compiled packages, conservatively analyzable ordinary
JavaScript, and genuinely opaque/dynamic behavior. An ordinary dependency can
remain ordinary JavaScript; it should not silently acquire different language
semantics because an application imports it.

Compilation cannot infer unavailable implementations or invent a notification
mechanism for an external mutable source. Unsupported required relationships
need an explicit diagnostic/boundary, not a claim of guaranteed reactivity.

### Version the artifact contract deliberately

Compiler internals are not automatically a stable publication format. Decide how
artifacts express required capabilities, runtime compatibility, and format
versions; reject incompatible inputs clearly or rebuild from available source.
Package discovery, fallback behavior, and any library-build CLI surface remain
open decisions, not documented APIs.

## Suggested sequence and acceptance gates

1. Correct general local/cross-module helper analysis and distinguish request
   state from payload readiness. The request-state-only and mixed conditional
   cases now have compile and runtime regressions; broader callback/facade cases
   remain part of the acceptance matrix.
2. Prototype reusable artifacts for ordinary helpers, using an unrelated package
   as well as our utils. Compare source compilation, cold artifact generation, and
   warm cached linking for equivalent behavior.
3. Extend the boundary to component libraries and verify consumer-dependent prop
   handling, SSR, HMR, source maps, and existing delivery optimizations.
4. Measure cold/warm build cost, artifact size, and browser output before selecting
   a public format and promising performance improvements.

Required regressions include import aliases and re-exports; lexical shadowing;
nested wrappers; source fields/arrays; mixed state/payload reads; returned facades
and callbacks; event-created requests and source rebinding; pending/error states;
action execution counts; unmount cleanup; concurrent SSR request isolation;
conditional entries and duplicate package versions; minified published packages;
stale/incompatible artifacts; and tree shaking/lazy route splitting.

The direction is general partial compilation plus automatic reactive linking.
Our utils would be an initial consumer, not a special case. Distributed live
adapters, a new renderer, and a new runtime tracking architecture are outside
this research scope.
