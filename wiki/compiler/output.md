# Compiled output

**Status: decided on 2026-10-20** (`../decisions.md`): the proposal below, no
signals. The user: "adopting means doing normal mutation stuff will require proxy
which the old one didnt have any issue with". Details of the emitted shape are the
Phase 3 design step of `plan.md`.

The user: "we have to be at least on par with the current one in terms of perf
whilst being more correct". The 2026-10-28 bundle work also measures production
minified and compressed output; the old compiler is a comparison, not a size goal
(`../decisions.md`).

## What the old compiler emits (the speed baseline)

This is the output that ranked second of ten in Octane (`d6e678b`, `testing.md`).
The authored counter:

```jsx
export function App() {
  let count = 0;
  return <button onClick={() => count++}>{count}</button>;
}
```

compiles to (from `packages/compiler-next/tests/out/a-counter/compiled/App.tsx`):

```js
export function App(_id, _parent) {
  const _document = _MD.getActiveEnvironment().document;
  let count = 0;                                   // state is a plain variable

  const _update = () => {                          // sets every dynamic spot
    _MD.setTextData(_text, count);
  };
  _MD.registerEntity({ id: _id, parent: _parent, render: _update });

  const _text = _document.createTextNode('');
  _MD.setTextData(_text, count);
  const _button = _document.createElement('button');
  _button.onclick = () => {
    const _returnValue = count++;
    _MD.invalidateEntity(_id);                     // schedule this component's _update
    return _returnValue;
  };
  _button.appendChild(_text);
  return _button;
}
```

The model:

- **No virtual DOM.** A component is a function that builds its DOM once and
  returns it. Static HTML is a hoisted template (`materializeMarkup`, `cloneNode`).
- **State and derived values are plain JavaScript variables** in that function,
  or module `let`s.
- **One `_update` per component** (an "entity") sets each dynamic spot. Spots skip
  unchanged values (`if (_slot !== value)`). Derived values are recomputed in it.
- **After a write, the handler tells the runtime:** `invalidateEntity(_id)` for this
  component, `commitWrites(['App.tsx#data'])` for module values (an access table maps
  each to the components that read it), `markDirtySubtree` for mutations it could
  not trace. The runtime batches and runs the dirty `_update`s.
- **Lists** are runtime regions (`createListRegion`): keyed reconcile, a row factory
  with its own `update(item)`, delegated events, and fast paths such as selection
  (`refreshKey` on just the rows whose `selected === id` changed). See
  `bench/dom/compiled-inline-app.ts`.

**Why it is fast:** direct DOM writes, per-spot change checks, cloned templates, and
list fast paths. **Why it was wrong so often:** not this model, but the compiler
deciding what to emit. Classification was spread over many passes, so it guessed
wrong about what is state, what re-runs and what to commit. Every failing case in
`tests/cases/` is such a decision. It also emits `try`/`finally` inside list rows,
which `../rules.md` forbids.

## What the test reference emits

```js
const $s0 = $ctx.memo(0, () => [$s1.v], () => 10 * $s1.v);   // recompute when inputs change
```

The reference keeps every value in a slot, re-runs every component after every
event, deep-copies inputs to see what changed, and matches virtual nodes against
the DOM. It is readable and plainly correct, which is its job, but each of those
choices is slow. It never ships (`testing.md`).

## Proposal: the old model, generated from the graph, with explicit memos

**Keep** what the benchmark measured: the runtime package, entities with an
`_update`, plain variables for state, direct DOM writes, templates, list regions
and their fast paths, write commits.

**Change** how it is produced and what `_update` does:

1. **Generated from the plan** (`core.md`): one graph decides what every binding
   is; emit only prints the plan. The authored AST is never edited.
2. **Derived values are explicit memos**, the reference's idea compiled cheaply.
   A derivation is recomputed only when an input changed, checked by **version
   numbers** that writes bump, not deep copies. Its body statements (`if`,
   loops) replay with it.
3. **Writes:** an assignment bumps the version and commits. A known mutating
   method (`push`, `sort`… from `optimize/methods.ts`) does the same after the call.
   An unknown call that receives a value gets the runtime check (copy before,
   compare after), only on that statement.

   The 2026-10-20 callback decision adds one requirement to this model: an executed
   later reassignment disables the binding's derivation. Before that write, it still
   follows its inputs. Callback registration does not disable it. Body invocations
   continue to build derived values, including through opaque callers. The emitted
   representation of that execution context and takeover flag belongs to Phase 3;
   the reference's accessor slots and deep copies are not the production shape.

4. **No `try`/`catch`/`finally`** in output.
5. **Readiness** from the graph's `pending` sets; spots show their `Group`
   policies (`sources.md`).

A sketch for `const total = 10 * qty` (names and helpers are decided in Phase 3):

```js
export function App(_id, _parent) {
  let qty = 1, _qty = 0;                      // value and its version
  let total = 10 * qty, _totalFrom = _qty;    // version `total` was computed from

  const _update = () => {
    if (_totalFrom !== _qty) {                // only when qty changed
      total = 10 * qty;
      _totalFrom = _qty;
    }
    _MD.setTextData(_text, total);
  };
  // …template and register as today…
  _button.onclick = () => {
    qty++;
    _qty++;
    _MD.invalidateEntity(_id);
  };
}
```

Version checks also replace part of today's reason routing: a spot or memo can
skip work by comparing numbers instead of re-evaluating.

## State lives anywhere, not only in components

The sketch above is the simplest place. A version belongs to a **binding**,
wherever it is declared, and a write is attributed to the binding at its root:

| Where the state lives | Example | How a write reaches its readers |
| --- | --- | --- |
| a component | `let count = 0` in `App` | the binding's version; the component's `_update` |
| module scope, any module | `export let todos = []` in `store.ts`, written in `List.tsx` | a version owned by the module, keyed like today's write keys (`store.ts#todos`); linking (`linking.md`) tells each module who reads it |
| a closure in a helper or factory | `function createStore() { let n = 0; return { inc() { n++ } } }` | the write is inside `inc`; the graph's summary of `createStore` says calling `inc` writes the store, so a call site commits `store` |
| a class instance or static field | `counter.value++`, `Config.limit = 5` | a member write commits its root binding (`counter`, `Config`) |
| an object or array reached from a binding | `user.address.city = 'x'`, `items.push(x)`, `alias.push(x)` | mutation commits the root binding; when the root cannot be known (an alias passed through unknown code), the reads of every possible root are refreshed, as `markDirtySubtree` does today |
| a prop | `({ label }) => … label = 'x'` | a local override until the parent passes a new value (`state-and-derived.md`) |

So versions live with the binding's owner: in the runtime, keyed by write key,
for module and shared state; emitted locals are only an optimization for state
that provably never leaves one component. That design is the Phase 3 step. A
write the compiler cannot attribute (third-party code mutating something it was
given) is `Opaque`: its readers update after the handler or effect that called
it, never silently stale.

## Phase 3 design (principles approved 2026-10-21)

The user approved these on the condition that they stay correct and miss no
unknown caller that reads reactive state: "yeah do it as long as it stays correct
and we dont miss any unknown caller that is somewhat reactive". Exact names and
helpers are settled while building the slices in `plan.md`, by measuring.

### 1. Versions and memos

Every reactive binding has a version that its writes bump. A derived value
remembers the versions it was computed from and is recomputed in `_update` only
when one changed (the sketch above). A version is a plain local when only the
component's own code reads it. The implemented shared representation also keeps a
plain version number next to the native binding, with a stable object key and
reader closure when a function leaves the owner or the binding lives outside a
component. Runtime subscriptions connect those keys to consuming component
batches. Values themselves stay native variables; module readers are exported
live functions, factory readers close over one invocation (`state-and-derived.md`).

### 2. Derive until takeover

A derived binding with candidate takeover sites (`BindingNode.takeovers`) gets a
"taken" flag. Only those sites set it, and only when they run outside the
owner's setup. The runtime keeps one value, the owner whose setup is running:

```js
// let total = price * 2;  items.forEach(i => { total += i; });  onClick={() => total = 0}
const _update = () => {
  if (!_totalTaken && _totalFrom !== _price) { total = price * 2; /* replay builders */ … }
};
items.forEach(i => {
  total += i;
  if (!_MD.building(_id)) _totalTaken = true;   // during setup it builds; later it takes over
});
_reset.onclick = () => { total = 0; _totalTaken = true; _total++; _MD.invalidateEntity(_id); };
```

The check is one comparison, emitted only at candidate sites. No API name decides it.

The local implementation uses `createBuildScope()` (`runtime/src/build-scope.ts`)
and temporary accessor targets (`features/derived/takeover.ts`). The final store
sets the flag after a successful native assignment; in the owning build scope it
instead preserves any value already taken over. This also protects one output of
a shared builder while another keeps deriving. Direct memo edges stop propagating
upstream changes through a taken binding. Exception recovery clears failed commit
ownership and abandoned setup frames at the next microtask. Existing authored
`catch`/`finally` boundaries restore the ownership captured before their `try`,
so synchronous nested-setup recovery happens before the parent continues.
No exception wrappers are added (`core/emit/recovery.ts`).

### 3. Possible builders

A statement that may build a value (`mySort(copy)`, `items.forEach(cb)` with an
unknown `forEach`, `console.log(x)`) runs once with its observation: a callback it
was given reports a write during the call, or a copy taken before is compared
after. If the value changed, a per-statement flag makes `_update` replay it; if
not, it never runs again (`state-and-derived.md`, "Timers and other setup side
effects").

### 4. Unknown calls are never re-run because the component updated

A computation re-runs only when one of its inputs changed. `const id =
setInterval(…)` has no reactive input, so it runs once, as in the console. This
replaces "re-read every opaque node when the owner updates" for calls.

### 5. No missed reactive reads through unknown callers

An unknown call can reach visible code that reads reactive state: a method on an
object (`pricing.total()`), functions taken out of a factory (`const { read } =
makeCounter()`), a getter on an object passed as a prop, a callback a host
function runs at once (`Array.from(items, x => x * factor)`). Static analysis
cannot follow all of these, so the runtime does:

- The graph finds every **escaping function**: a function whose value is stored,
  passed, returned or exported, rather than only called directly. Getters and
  methods count.
- If an escaping function reads reactive bindings, its body starts with one check:
  when a computation is running, it reports the version cells of what it reads.
  `_MD.tracking !== null && _MD.track(_price, _qty)`.
- A computation that contains an unknown call runs with tracking on, and keeps
  the reported cells as extra inputs, compared by version in `_update`.

So every reactive binding the compiler can see reaches a computation either as a
static input or as a reported read. What stays unseen is state inside host APIs
and uncompiled package code; like an unwritten global, it is not an input
(`../decisions.md`, 2026-10-21). Packages that the compiler compiles (Phase 9)
are visible code.

Cost: one null check in escaping functions that read state, and version capture
only for computations that contain unknown calls. Functions called directly
(`multiply(price)`) are expanded statically and pay nothing.

### 6. No `try`/`finally` around tracking

Setting and restoring the running computation must not use `finally`
(`../rules.md`). If a computation throws, the runtime resets the tracking state at
the start of the next update batch, so the error cannot leak into another
computation.

### Cases that hold the design to this

`cases/state-and-derived.callbacks.test.ts`: the timer cases, and the "unknown callers" cases: a
method on an object, factory functions taken out by destructuring, a getter on a
prop object, a host function running a callback at once, and a call with a side
effect running once across unrelated updates. All pass on the reference; the old
compiler fails the first, second and fourth.

### Stored JSX values

JSX assigned, passed or returned through an ordinary helper captures its site
values at that expression's native evaluation point. The compiler hoists a DOM
binding program and emits `createRenderValue(program, captures)` at the expression.
Each consuming slot mounts separate DOM, selects HTML/SVG from its destination,
updates captures in place for the same program and disposes replaced ranges.
The mount/update/disposal program is shared between namespaces; node creation
uses the component template emitter and its separate HTML/SVG prototype caches.
Values remain ordinary lexical variables; this adds no signals or generic virtual
tree reconciliation. Array children are lists (Phase 5's general rule).

## Phase 6 design (2026-10-24)

Follows from rules already approved; nothing here needs a new semantic choice.
`components.md` holds the rules and cases.

### 1. A component call is a value

`<Label text={name}>hi</Label>` is a render value, like stored JSX:
`createComponentValue(Label, props, key)`. The value slot that shows it mounts
the component; a write with the same component and key updates its props in
place; another component (a factory, a dynamic tag) or another key mounts anew.
A string tag (`<Tag>` holding `'h1'`) mounts a host element whose attributes,
events and children are set generically. One path covers static, member and
dynamic tags, keys and remounting, and a component in a list row. Phase 5's fast
paths later compile the common shapes more directly.

`props` is built in source order: attributes and spreads as written, without
`key`; `children` is the single child, or an array of several, as the reference
builds it. Handlers and render callbacks are ordinary values.

### 2. The calling convention

A compiled component is `Name(_id, _parent, _props, _namespace, _setupOnly)`. The
first three are what the runtime's `mount`, the test harness and the bench builds
pass; the last two are optional. `_props` is a props cell from the runtime
(`createPropsCell`), or undefined at the root, which reads as `{}`. The value slot
calls it with a fresh child id under its owner and its consuming namespace
(`'svg'` inside an SVG element). `_setupOnly` serves discarded calls (`Row();`):
setup runs, nothing is mounted. A props cell also retains the complete native
argument list for direct calls, map callbacks and rest parameters.

Namespace follows the consuming slot, including custom tags and stored markup
used in both HTML and SVG. `foreignObject` explicitly restarts HTML. The emitter
keeps cached HTML cloning and an SVG creation variant where the template can
inherit its destination. A list of known SVG tag names cannot prove that the
other names will only be consumed in HTML.

A component used for its value (`items.map(Row)`, `const view = Row(x)`) gets
`componentValue(Row)` at that reference instead: a function returning
`createComponentValue(Row, props)`. Calling it shows the component, as the
reference's direct call returns its markup. A call whose result is discarded
(`Row();`) still calls the component, which only runs its setup.

### 3. Props in the child

Parameter patterns leave the signature. Their bindings are declared at
setup from `_props.arguments` (whose first value is `_props.value`), and each gets a version, so reads of a prop update like
reads of state. When the parent sends new props, the cell calls the child's
receiver, which destructures them into temporaries (defaults and rest included,
natively) and, for each binding whose value from the parent changed
(`Object.is`; field by field for a rest binding, which is a new object every
time), assigns it and bumps its version. A prop the child wrote keeps its value
until the parent sends a different one (`state-and-derived.md`, `Prop`).

A value passed again may have been edited in place (`item.label += '!'` in the
parent). Every compiled edit stamps the object it changed with a time from the
runtime's mutation clock (`mutation.ts`). The receiver keeps the time it last
received props and bumps a binding passed again only if `mutatedSince(value,
seen)`: an edit since then reached the value or data below it. When no edit
happened anywhere the check is one comparison. A JSX call's props object is new
on every evaluation, so the props cell keeps the child's object while its fields
are the same (`sameProps`). The receiver marks the child's batch only when a
binding changed, so in a list of 1,000 rows an edit to 100 items updates 100 rows,
and a reorder updates none.

`sameProps` includes enumerable symbol keys and observable key order, matching
native spread/rest. It also compares array length. These checks apply to the
compiler's props containers and newly built rest values, not arbitrary authored
object identity. An unchanged object prop still follows `mutatedSince`.

`features/components/dom.ts` builds ordered props; `features/props/dom.ts` emits
native pattern setup/reception. Runtime `components.ts` keeps compiled callable
metadata in weak collections and supplies an ordinary-callable fallback for
opaque tags. The fallback collects executed reads and owns the returned value's
slot. Local cross-owner reads publish versions after their owner settles.
Top-level components register a `registerRootFactory` definition, retained on a
callable adapter passed to `mount`. Its factory calls the compiled component with
the stable module/component root identity and a props cell.

## Alternatives considered

- **Signals** (Solid style: every value an object, reads become calls). A new
  runtime and no measured baseline. Plain-object mutation (`items.push(x)`,
  `user.name = …`) would need proxies or wrappers, against "write normal
  JavaScript". Not recommended.
- **Ship the reference model.** Correct, but deep copies and re-running every
  component make it far slower than the baseline. Not recommended.

## Open

- The exact version mechanism for each row of the table above, decided by
  measuring in Phase 3 (rule 1 above gives the default).
