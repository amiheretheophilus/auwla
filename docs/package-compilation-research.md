# Separate package compilation and reactive linking

Status: active compiler work, started 2026-10-16. Request-state and payload
relationships now link across local functions, imports, aliases, and re-exports,
including helpers that use both relationships. A versioned, explicitly
experimental artifact proves separate compilation for argument-relative
ordinary helpers and precompiled prop/local-state/slot components. Vite
discovers those artifacts from package metadata. The contract remains
experimental; package module state and broader component facilities stay
deferred.

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
- [Source acceptance](../packages/vite/src/paths.ts) continues to exclude files
  under `node_modules`; Vite discovers their semantic artifacts separately so
  package source does not enter the application graph.
- [Transparent read analysis](../packages/compiler/src/analysis/transparent-reads.ts)
  now relies on linked function summaries for package helpers. The former
  `@memoized-dom/utils`/`optimistic()` source-field exception has been removed.

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

### Experimental helper artifact

The first semantic proof is available through `experimentalCompilePackage`:

```js
const compiled = experimentalCompilePackage({
  './index.ts': helperSource,
}, {
  packageEntries: { 'story-utils': './index.ts' },
});

// The host writes `compiled.output` as the package's JavaScript and stores the
// JSON-serializable artifact beside it.
const application = compileModulesDetailed(applicationModules, {
  experimentalPackageArtifacts: [compiled.artifact],
});
```

The consuming compile receives no package source. An exact bare entry specifier
such as `story-utils` or `story-utils/status` maps named imports to portable
argument-relative function summaries. The emitted JavaScript remains a normal
package import and must resolve through the host or bundler; the artifact carries
semantic linking information, not executable code.

The artifact accepts ordinary named helpers and precompiled components whose
reactive state is component-local. It rejects compiler-owned package module
state and routed preparation. Package authors
may mark an entry `runtimeOwnedState: true` when its ordinary JavaScript module
state is fully owned by the emitted package runtime and must not become part of
the consuming application's reactive graph. That assertion is needed for the
optimistic utility's private operation-deduplication `WeakMap`s; its portable
artifact still exposes only argument-relative effects.

The artifact supports argument-relative request-state reads, payload reads,
writes, and transparent-source provenance. Namespace imports remain unsupported
because they do not identify one reactive export. Vite resolves bare imports,
reads the package's `memoized-dom.artifact` declaration, watches both the
manifest and artifact, and passes the summary to the application linker. Direct
compiler callers pass artifacts explicitly. Entry matching is exact.

### Optimistic utility proof

`@memoized-dom/utils` is now compiled into the same artifact as the request-state
projection helpers. Its generated summary says that `options.source` consumes
request-holder identity. That general property-path relationship works through
an aliased import and through inline arrays of multiple sources. The compiler no
longer contains the utility name or package name.

The utility's package build supplies one lower-level contract for
`protectLiveSources`: argument zero consumes holder identity without consuming
its resolved payload. Package compilation composes that opaque runtime boundary
through `optimistic` and emits the public relationship. This is the unavoidable
dependency information for behavior hidden behind an imported function; it is
not application-facing syntax or a compiler exception for the utility. The
compact `definePackageBoundaries` builder owns the versioned artifact shape for
this rare case; ordinary package functions and components remain fully inferred.

### Precompiled component proof

The package compiler records the component's fixed prop/slot contract and emits
its factory once. The consuming application uses that metadata to lower call
sites, project explicit slots, assign IDs, and push prop changes without parsing
or compiling the package source. A runtime regression covers component-local
state, parent prop updates without remounting, default-slot projection, nested
package components, retained keyed lists, and forwarded DOM refs; another
renders a precompiled package component during SSR. Vite discovery keeps the
package source outside the application graph.

The emitted package factory currently uses the ordinary component ABI. Package
artifacts therefore deliberately report `listLightweight: false`, even when the
component could use the application compiler's lightweight keyed-row ABI in a
whole-program build. An application can still map a packaged component as a
keyed row and retain its DOM identity; it merely takes the general component
path until a portable dual row ABI is designed.

Package compilation already returns authored maps alongside every emitted
module. Package builds must carry those maps through later bundling or publish
the corresponding map file and URL; the semantic artifact does not replace that
ordinary JavaScript toolchain responsibility. Vite now records package manifests
and artifacts as normalized semantic graph inputs. Artifact edits recompile
consumers, surface invalid metadata through the normal overlay, and recover via
HMR after repair, including on Windows path conventions.
The versioned artifact is validated as untrusted input before either direct or
Vite-driven linking, with diagnostics naming the malformed entry, export, and
field.

Package discovery also retains the importing module's resolution. Two modules
can resolve the same bare specifier to different installed artifacts without
conflating their function or component contracts. The application linker uses a
canonical digest of each validated artifact as its semantic instance identity,
not an absolute package path; equal artifacts may share compiler facts while the
host keeps their ordinary ESM resolution intact. This solves duplicate semantic
versions without claiming that the digest verifies the separately published
JavaScript.

### Static initial delivery now uses a deferred render contract

A package may now carry a small package-owned render plan with symbolic scalar
prop and slot inputs. The package compiler generates it automatically for one
closed host root made from static platform DOM, direct scalar reads, and compiler
slots with portable fallbacks. Application linking substitutes actual call-site
values and finishes the existing initial-content plan without reading package
source.

The plan is versioned build data and is validated with the rest of the untrusted
artifact, including its declared prop/slot references and structural limits. It
contains neither executable callbacks nor compiler AST. Executing an arbitrary
package factory during a build remains unsafe and host-dependent, while
serializing source or the current internal AST would recreate per-application
parsing and expose an unstable compiler representation.

A wholly static component call emits HTML and omits its package factory call.
The slot-free subset also supports a generated `host-v1` adoption capability.
The package compiler derives a host-relative DOM plan from the same render
template and emits one factory with optional adoption and ordinary creation
paths. Every symbolic prop stays live in that factory, even when a particular
consumer initially supplies a constant. The application linker specializes the
initial values and passes the existing host to that factory. Node addresses stay
owned by the package; consumer-specific absolute paths stay in the application.

End-to-end checks cover repeated instances, reactive text and attributes, empty
initial text, retained element identity, conditional removal and fresh mounts,
plus Vite discovery without admitting package source. This reuses the existing
binding emitter and does not add another runtime hydration mechanism.

Dedicated slot hosts now support a second generated capability,
`host-slots-v1`. Each `<slot>` must be its host's only child, without fallback
content. The package binding plan owns that host but contains no projected
descendant addresses. The consumer specializes the projected content into
caller-owned slot plans, keyed by component call site and prop name, relative
to the real mount host. Different instances can therefore project different
widths or omit slots without shifting any package-owned bindings. Ordinary DOM
plan merging still checks the package host shape.

Transparent forwarded-slot fragments mount directly into the real parent;
caller JSX-prop fragments likewise bind their contents there rather than
creating an intermediate fragment for structural anchors. This uses the
existing slot ABI, update closures, lifetime cleanup and optional host argument,
not a new slot runtime. Production Chrome checks cover initial HTML without
JavaScript, original node retention, projected events, draft preservation and
conditional remounts. Compiler regressions also cover multiple instances with
different extents, omitted named/default slots, and caller lists/conditionals.

Mixed siblings and fallback branches still need a broader placement contract.
Components with their own events, refs, effects, setup statements, nested
components, or dynamic structure also still use ordinary creation for
browser-only initial delivery. Runtime SSR/hydration remains available. A
symbolic HTML shape alone cannot grant those broader adoption capabilities.

Prop modes are intentionally exact. A typed scalar prop remains scalar; an
authored render prop remains JSX-bearing. Cross-mode consumer calls fail during
application compilation rather than adapting the already-emitted package
factory differently. This is the portable subset that avoids serializing the
compiler's internal AST while preserving consumer-owned call-site work.

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

### Current compilation-cost measurement

The repository includes `bun run bench:package-compilation`. It compares an
application linked with all package source present against the same application
linked from a previously generated semantic artifact. On the Windows/Bun
development machine used on 2026-10-16, the warm median results were:

| Helpers | Package modules | Source-linked app | Artifact-linked app | Ratio |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 9 | 155.7 ms | 40.0 ms | 3.89x |
| 32 | 33 | 336.8 ms | 29.1 ms | 11.58x |
| 64 | 65 | 478.6 ms | 24.3 ms | 19.72x |

Cold artifact generation took 366–494 ms and produced 1.2–9.3 KiB of JSON for
2.2–17.7 KiB of synthetic package source. Generation is package-owned work;
applications reuse its result. These numbers validate that excluding package
source can materially reduce compiler work for this synthetic graph. They are
not a general build-time promise: the app imports at most eight helpers, the
benchmark does not include bundling or filesystem discovery, and real packages
will have different parsing, linking, I/O, and plugin costs.

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
2. The helper artifact links an unrelated package without its source,
   drives the real request-state and optimistic utilities, composes through
   package re-exports, and preserves event-created request holders. Vite now
   discovers package artifacts automatically. Source compilation, cold artifact
   generation, and warm linking now have a reproducible benchmark.
3. The first component-library boundary covers exact scalar/render-prop modes,
   local state, explicit slots, nested components, retained keyed lists, Vite
   discovery, forwarded refs, SSR, authored source maps, and package-artifact
   HMR/recovery. Importer-specific resolution also keeps multiple installed
   semantic versions distinct. Existing initial-delivery optimizations remain
   acceptance work before broadening the contract.
4. The reproducible synthetic benchmark now measures cold generation, warm
   linking, and artifact size. Browser output, filesystem/plugin cost, and real
   package workloads still need measurement before selecting a public format or
   promising performance improvements.

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
