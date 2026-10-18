# Tracing events, bindings, and DOM updates

Press **Alt+Shift+M** during development to open the separate
[`@memoized-dom/devtools` inspector](../packages/devtools/README.md). Its Events
and Regions views list attached sites before interaction and flash when they
run, without enabling console output. There is no Reactivity tab. Console
tracing remains available independently using the settings below.

Run `memoized-dom dev`, enable **Verbose** in the browser's Console, and enable
tracing from that Console:

```js
globalThis.__MEMOIZED_DOM_TRACE__ = true;
```

Interact with the application and filter the Console for `[memoized-dom:trace]`.
No application imports, handler wrappers, or changes to component authoring are
needed. Broad tracing is off by default, even when Verbose is visible.

Disable it immediately:

```js
globalThis.__MEMOIZED_DOM_TRACE__ = false;
```

This setting belongs to the current browser page. Reloading resets it; enabling
it after load traces subsequent work, not the already-completed initial mount.
It does not enable server tracing or change another tab's settings.

## Filter before investigating a busy screen

```js
// Owner IDs include the component/region/row path.
globalThis.__MEMOIZED_DOM_TRACE__ = { component: 'ExpeditionDetail' };

// Only messages attributed to an expression/write mentioning this name.
globalThis.__MEMOIZED_DOM_TRACE__ = { source: 'count' };

// Both filters must match. Matching is case-sensitive substring matching.
globalThis.__MEMOIZED_DOM_TRACE__ = {
  component: 'Counter',
  source: 'count',
};
```

The source filter uses the names included in that message's metadata, not an
inferred transitive dependency graph. An expression reading `total` can display
`total` even if its calculation depends on `count`; a row can display its item
parameter rather than the parent collection name. Events and update boundaries
carry owner IDs but no source names, so a source filter hides those boundaries.
Use the component filter alone to see an entire interaction.

## Read the stages separately

For an ordinary counter, a trace can look like:

```text
event-started       component: App/Counter, type: onClick, eventId: 4
write-published     component: App/Counter, sources: [count], eventId: 4
event-returned      component: App/Counter, type: onClick, eventId: 4
update-started      component: App/Counter
binding-evaluated   component: App/Counter, binding: binding:0, sources: [count]
dom-write           component: App/Counter, operation: text, sources: [count]
update-completed    component: App/Counter
```

- `event-started` / `event-returned` bracket a compiler-owned JSX handler's
  synchronous invocation. Returning a promise is not the same as completing
  that promise. `event-threw` records a synchronous exception and preserves it.
- `write-published` records compiler-emitted write publication. These effects
  can be conservative; they are not observations of every assignment or proof
  that a value changed. `fallback: true` identifies conservative/event fallback
  publication. Existing write coalescing and dependency routing are unchanged.
- `update-started` / `update-completed` bracket an invoked registered update
  unit, which can be a component, conditional, list region, or data binding.
  `update-threw` leaves the original exception on its existing reporting path.
- `binding-evaluated` means a generated binding passed its dependency gate. Its
  memoized value comparison can still skip the DOM operation. Binding suffixes
  are local to an owner/update scope and can change after recompilation.
- `dom-write` records a traced text or explicit scalar/class/property attribute
  operation after it executes. Text equality and attribute slot guards remain
  in place. This is not a paint event or a measurement of rendering duration.

A component update with no `dom-write` can therefore be entirely correct. The
framework reevaluated bindings and found that their DOM values were unchanged.
Several writes can still batch into a single update.

`eventId` associates synchronous nested publication with its event boundary.
The tracer does not extend that scope across `await`, timers, subscriptions,
or later scheduled commits, and does not claim that a later update has one
exclusive cause. Owner IDs and source names remain the way to follow those
later stages. Requests remain concurrent.

## Coverage and limits

The visual inspector presents authored browser JSX first: component, file,
line/column and the nearest enclosing JSX element, with the exact expression or
event attribute highlighted. A labelled input includes its enclosing label;
unrelated component JSX is not displayed. These addresses come from original compiler AST
ranges, not guessed runtime labels. Generated steps without an original JSX
anchor say so. A section is bounded to 24,000 characters plus indentation;
oversized sections fall back to a smaller enclosing section when available.
Synthetic page-companion modules currently have no authored JSX context.
Static JSX literals and handler code are visible in this development-only view
and its explicit diagnostic export. Surrounding imports/declarations and server
preparation bodies are excluded; source code is not added to console logs.
Events and conditional-region checks have separate inspector tabs. A condition
can be checked without changing branches; the Regions view does not count
checks as component rerenders or branch replacements.

This is console tracing, not a profiler or a complete DOM mutation inspector.
It covers compiler-owned explicit JSX event handlers (including explicit
handlers alongside spreads and delegated row handlers), emitted callback write
commits, registered update units, generated binding evaluations, and guarded
text/explicit attribute writes. Retained row/slot functions can evaluate their
bindings directly without invoking a separately registered update unit.

Style-object diffs, opaque event handlers supplied only through a spread,
structural insert/remove/move operations, manually authored DOM writes, and
third-party internals do not all have individual operation/event messages in
this first implementation. Region/binding evaluation is not proof that such
an operation occurred. Compiler source labels are debugging hints, never inputs
to reactivity analysis or invalidation decisions.

No payloads, text values, input values, event objects, DOM nodes, or state
snapshots are included. Component paths and binding names can themselves be
sensitive; keep development logs private. Console tracing retains no history;
the optional open inspector retains a bounded metadata history. Neither adds a
DOM observer, state proxy, application subscription, or automatic promise tracking.
Console failures do not prevent an event or update from completing.

Continuous/volatile updates can be chatty. The console reporter allows at most
200 ordinary trace messages per one-second window, with at most 100 repetitive
update/binding-evaluation messages so they cannot consume the entire budget
for events, publications, and DOM writes. It emits one `trace-throttled` notice
when a budget is exceeded and omits messages exceeding that budget. It
records the observed component, binding/source labels when available, triggering
event, budget reason and recorded counters on that notice. These describe the
boundary where sampling began, not attribution of all preceding work. It
does not defer application work, queue traces, or start a timer. Narrow filters
and disable tracing after reproducing an issue. Console work itself adds
overhead; these logs are not suitable for production performance measurements.
Live protocol messages and warnings use their separate reporter and are not
subject to this broad-tracing cap.

The Vite adapter emits these hooks only for development browser compilation;
production builds omit the tracing import and generated calls. Direct compiler
hosts can select `diagnostics: true` when compiling development output. The
hooks use the existing development runtime entry (`hotRuntimePath` for custom
compiler hosts), without requiring another application/runtime alias. The
development runtime also checks Vite's `import.meta.env.DEV`, falling back to
`NODE_ENV === 'development'` outside Vite; a global flag cannot enable production
logging. These debugging helpers are compiler-owned, not application APIs.

## Relate this to live diagnostics

[Live diagnostics](./live-diagnostics.md) continue using `[memoized-dom:live]`
and are independent of the broad tracing flag. Each live protection message
now includes its source's HTTP method, name (for example, `getNotes`), and an
opaque source ID. Two protected sources sharing one invalidation key are
therefore distinguishable: `getNotes` and `getExpeditionSummary` are separate
live queries, even though one mutation affects both.
