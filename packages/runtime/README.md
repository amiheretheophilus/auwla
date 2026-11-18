# @memoized-dom/runtime

This project does not support legacy APIs. All packages and consumers must use the current APIs. Do not add compatibility shims, deprecated aliases, or fallback paths for superseded APIs.

Dependency-free registry, scheduling, optional dirty-reason batching, keyed row
lists, conditional and value regions, cleanup/ref ownership, mutation
observation and DOM value helpers for compiler-next's output. The old compiler's
operations (its access table, event commits, state cells, value-cached setters,
props boxes, list regions, initial-HTML bindings and claim-plan hydration) went
with it on 2026-11-18.

The package build preserves ESM module boundaries so an application bundler can
remove unused feature initialization. Browser payload is measured after bundling
the compiled application, rather than by summing the entire runtime package.
See [Browser JavaScript architecture](../../docs/browser-bundle-architecture.md)
for measurements and the remaining separation work.

The kernel shares one registry, dirty queue, commit drain and teardown path.
Compiler-proven non-polling registrations use `registerEntity`; general
`register` includes the optional opaque-pull driver. Effects and computed
registrations without polling use the same core registration. Polling remains
available for unknown mutable sources, including failed-render recovery.

Scoped context propagation lives in `application-scope.ts` and initializes on
explicit `runWithApplicationRuntime` use. Ordinary browser updates can omit
that adapter and `async-storage.ts`. A later server entry still installs the
host's AsyncLocalStorage through the existing lazy storage factory. Scheduled
commits and pull callbacks retain their originating runtime and restore the
previous context, including after errors or disposal.

Root ownership and validation live in `mount-core.ts`. Mounted handles retain
their originating runtime for unmount and restore the caller's context even when
cleanup throws.

Full-owner invalidation uses `invalidateEntity`; compiler output carrying exact
causes and the general `markDirty` APIs use `reasoned-invalidation.ts`. Both
publish through the same queue and commit drain. Full updates dominate pending
exact causes, including exact writes arriving later in the same batch.
Per-runtime isolation and failure/cycle safeguards remain shared.

Application source does not need to import reactive primitives. The ordinary
browser entry imports only the mounting boundary:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

Generated modules import this package as one namespace:

```js
import * as MD from '@memoized-dom/runtime';
```

`mount()` resolves string targets with `document.getElementById()`, owns only
the nodes produced by the compiled root, returns an idempotent `unmount()`
handle, and keeps the compiler's private factory ABI out of authored code.

## Adopting server HTML

With `import '@memoized-dom/runtime/hydrate'`, `mount()` adopts the server's
HTML for its root (`hydrate-program.ts`, `adoption.ts`). The server numbers each
node a creation makes; the client render takes node N for creation N when it
fits, and makes its own where it does not. HTML without numbers is a mismatch:
the root is mounted again from nothing. Pass
`{ onHydrateError(error, scope) { /* log mismatch */ } }` as a third argument to
observe both: `'region'` when part of the root rendered on the client, `'root'`
before the whole root is replaced.

## Failed renders

A failed ordinary render retains a full dirty mark for the next commit. This
prevents a subsequent pull or partial write from skipping slots that the failed
render never reached. Independent render entities and their cascades finish
before the error is reported. The failed entity and its descendants wait for a
later commit; effects wait for coherent render completion. One render error is
re-thrown unchanged, multiple independent errors are aggregated. The runtime
does not schedule an immediate retry or roll back completed writes. Failed
effects keep their existing behavior; unregistered or replaced entities are not
revived. A stale batch entry cannot render a replacement with the same ID.

A synchronous render error during an opaque pull still schedules the next
browser frame. The original error propagates, and recovery uses the retained
full dirty mark. Removing the last volatile owner or disposing its application
during the failed render prevents rearming; no immediate retry is added.

## Entity teardown

`unregisterSubtree()` removes the registered subtree before running cleanup hooks,
with descendants disposed before their owners. Entities without child links use
a direct removal path. Traversal buffers are retained for nested owners; error
arrays are created only when a cleanup reports a failure. Owner cleanups still
run in reverse registration order, and reported failures do not stop later hooks.

Registry generation advances before removal notifications and cleanup hooks.
Each removal invalidates the cached ID list before notifying listeners, so calls
to `registeredIds()` during teardown reflect the current registry. Previously
returned ID snapshots keep their contents.

## Conditionals

Disposed conditionals (`createCondRegion`) cannot resume work after authored
callbacks. Returned entries from a factory that unmounts its owner are cleaned
separately. Disposal retires the entry before invoking its hook and finishes
content/anchor removal when that hook throws. Failed construction preserves the
original error, including a thrown `undefined`, and removes the region anchors.

The package is independently buildable:

```bash
bun run build
```
