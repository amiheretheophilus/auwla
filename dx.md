# Auwla developer experience: JSX+ design discussion

Status: evolving prototype design. Accepted directions and open proposals are
identified separately; the complete grammar is not settled.

Created: 2026-11-05.
Updated: 2026-11-11.

Work branch: `prototype/jsx-plus`. Start at [wiki2/README.md](wiki2/README.md)
for the code map, current slice, acceptance examples and handoff.

The initial [language extension spec](wiki2/spec/README.md), version 0.1-draft,
defines the first core profile's grammar, syntax model, semantics, diagnostics
and conformance fixtures. The broader features below remain discussion material
where they are outside that profile. A working draft can evolve as we prototype.

This document collects the proposed JSX+ authoring experience, the research behind
it, and the decisions we need to iterate on. Syntax examples are proposed unless
explicitly described as existing behavior. A recommendation is not an accepted
decision. Nothing here authorizes changing the compiler's established semantics.

The user has specified that TypeScript content mappers will be part of the design.
They are the new TypeScript API for integrating custom source formats, not data or
content transformation libraries.

Backend authoring direction (2026-11-11): `.auwla` may also contain pure backend
JavaScript/TypeScript, including imports of Express and other backend packages.
Configuration will identify backend files and/or folders. That code is ordinary,
nonreactive backend code; the extension does not activate UI reactivity.
Configuration/loading support is planned, its exact syntax is open, and
isomorphic support will be added later. See [the architecture note](wiki2/architecture.md#backend-authoring-planned).

Accepted direction from the 2026-11-10 discussion:

- JSX+ extends compiler-next with authoring features that ordinary JSX cannot
  express. Its syntax implementation lives in the separate `packages/jsx-plus`
  package, which passes normalized TSX to compiler-next's public API and existing
  parse, resolve, graph, plan, optimize and emit pipeline. This does not create
  a second reactive compiler or move prototype code into compiler-next.
- Refs are already implemented. Preserve their ordinary variable declarations
  and `ref={variable}` connection. Element tags do not declare refs, and refs
  need no `$` prefix. This is compatibility work, not a new ref implementation.
- In the proposed markup body, quote literal text: `<div>"text"</div>`.
  Read ordinary expressions directly: `<div>message</div>`.
- Support direct `if` statements and ordinary expressions such as `.map()` in
  markup bodies without an extra expression-container pair of `{}`. JavaScript
  block braces and object-literal braces retain their purposes.
- Develop this through small, revisable experiments. The plan and grammar can
  change as evidence arrives; the current rules, examples and checks change with
  them. See [decisions](wiki2/decisions.md).

DX-32 adds optional `prop=(expression)` attribute values alongside existing JSX
braces. Ordinary value/event evaluation remains unchanged; callbacks stay explicit.
Separators, the final file extension and remaining feature proposals remain revisable.
This direction is for the new authoring format; it does not change TSX text rules.
Revision 1 provisionally uses host expression continuation/ASI and explicit
separators where child expressions would otherwise join. That is a draft to
test, not a blanket user decision to require semicolons after every child.

## 1. What we are designing

Auwla already aims to let people write ordinary JavaScript and TypeScript and get
efficient reactive output. JSX+ explores a richer markup surface around that code:
lazy event expressions, modifiers, bindings, control flow, styles and element-owned
behavior inspired partly by Imba. The current prototype direction makes
JavaScript the default in markup bodies, with quoted strings for literal text.

We should evaluate the proposal against concrete programs, including complex ones.
Few characters alone do not establish a good design. Useful questions include:

- Can someone predict when an expression runs and which value it reads?
- Do related forms compose without introducing surprising exceptions?
- Can ordinary functions, callbacks and JavaScript expressions still be used?
- Can TypeScript check the authored program and offer useful edits?
- Does the syntax expose enough information to compile efficiently?
- Are ownership, cleanup, server rendering and asynchronous behavior defined?
- Is a convenience saving repeated work, or hiding a separate feature?

There is no blanket decision here to prefer either minimal syntax or explicit
syntax. Choices marked accepted above guide the prototype; the remaining choices
stay open until we settle their behavior and examples.

## 2. Boundaries that the syntax must preserve

- Both `let` and `const` can participate in reactivity. Their declaration keyword
  does not classify a value as state or derived.
- A derived binding follows its inputs until an actual later reassignment takes
  control. Creating a callback that might write it does not perform that write.
- Mutating an object is different from reassigning its binding. A `const` object
  can be mutated; a `const` binding cannot be reassigned.
- Existing JS/TS/JSX/TSX files retain their meanings. The new authoring format
  changes markup-body syntax; it preserves ordinary JavaScript expressions and
  functions. Direct control flow must not make `.map()` or ternaries second-class.
- Unknown code needs the general conservative path. Syntax conveniences must not
  silently require a compiler-recognized method name or a special object shape.
- Updates follow synchronous stretches, including the boundary before an `await`.
  A timing modifier must not postpone unrelated writes already performed.
- Refs remain reactive through normal declarations and the existing `ref` prop.
  Preserve mount, replacement, absence and cleanup behavior.
- Generated code must follow the existing restriction against introducing
  `try`/`catch`/`finally` wrappers.
- Performance claims require measurement. Compact source does not by itself imply
  smaller output, cheaper updates or fewer allocations.

These are compatibility constraints, not a new definition of Auwla reactivity.

## 3. Research: TypeScript content mappers

### 3.1 What is available

Microsoft announced content mappers in TypeScript 7.1 beta on 2026-10-20. A mapper
integrates custom source extensions into TypeScript by producing virtual source
and mappings back to authored text. This is relevant to `.auwla` even when its
markup is not valid TSX. See [Microsoft's announcement][ts-announcement].

The implementing [content mapper pull request][ts-mappers] describes the protocol:
an external process receives project and file requests and returns virtual source,
span mappings and optional diagnostics. A mapper is responsible for understanding
the original syntax; TypeScript does not learn the JSX+ grammar automatically.

The CLI requires permission to run mapper code through `--runExternalCode`.
Editor integration also depends on workspace trust and mapper permissions.
The exact supported toolchain should be pinned and verified during a prototype;
this document is not a claim that every installed TypeScript 7 build supports it.

Prototype project configuration, using the private workspace mapper package:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true
  },
  "contentMappers": [
    {
      "package": "@memoized-dom/jsx-plus",
      "extensions": [".auwla"]
    }
  ],
  "include": ["src"]
}
```

The local example is now exercised through the actual TypeScript 7.1-beta CLI
and language server; see [tooling](wiki2/tooling.md) for exact settings and
limitations. This does not replace the repository's `bun check` workflow.
The mapper's Node-compatible JSON-RPC transport is independent of the VS Code
editor; other IDEs still need compatible TypeScript content-mapper integration.

### 3.2 What this enables, and what we still own

| Area | Role of the mapper | Work Auwla still owns |
| --- | --- | --- |
| Type checking | Project JSX+ into valid TypeScript | Correct types for events, bindings, components and generated declarations |
| Diagnostics | Map virtual locations to authored locations | Parse diagnostics and meaningful errors for framework syntax |
| Hover and navigation | Project positions and results | Accurate symbols and mappings in the virtual program |
| Rename and completion edits | Apply edits through eligible mapped spans | Preserve authored names and avoid unsafe edit projections |
| Markup | TypeScript can inspect a generated representation | Parser, syntax recovery, tag rules and extended attributes |
| CSS | No automatic CSS-language implementation | Scoping, diagnostics, completion, formatting and CSS output |
| Runtime | No automatic reactive implementation | DOM/SSR compilation, scheduling, ownership and cleanup |
| Formatting | Mapped TypeScript regions can participate | A strategy for the complete `.auwla` grammar |

Do not promise that an existing TSX formatter works merely because tags have
closing tags. Direct `if`/`for` blocks, expression children and modifier attributes
need grammar support.

### 3.3 Mapping quality is a design requirement

The protocol distinguishes verbatim spans from transformed spans. As documented
in the implementing PR, text edits require exact, length-preserving verbatim
mappings. A feature flag alone does not make a transformed span safe to edit.

Prefer to preserve authored identifiers, expressions and types verbatim while
adding generated scaffolding around them. For example:

```tsx
// Authored JSX+
<button @click={count++}>"Add"</button>

// Simplified virtual TypeScript, not production runtime output
<button onClick={(event) => { count++; }}>{"Add"}</button>
```

`count++` and the quoted string should map to their exact authored spans. The
virtual child's braces, generated event parameter and wrapper have no authored
declaration. Actual contextual event types must come from Auwla's own JSX
declarations or checking helpers.

Avoid rewriting a whole component into one opaque mapping. Verify rename and
completion insertion, not just whether errors appear near the right line.

Particular risks to probe:

- Renaming a state binding used by markup, handlers and bindings.
- Renaming a normally declared ref through its `ref={input}` use and handlers.
- Renaming a custom event when authored and virtual spellings differ.
- Auto-import insertion around styles and module declarations.
- Unicode before an expression, so offset encoding mistakes become visible.
- Incomplete markup during typing, including missing braces and closing tags.
- Diagnostics inside generated helpers: unmapped does not mean suppressed.

### 3.4 Compiler-next extension architecture

Implement additional syntax in `packages/jsx-plus`, preserving source ranges and
ordinary TypeScript regions. That package normalizes into standard TSX and calls
compiler-next through its public API. Compiler-next's existing parse, resolve,
graph, plan, optimize and emit stages own subsequent compilation. Reuse current
binding, reactivity, ref, list and ownership behavior. Keep prototype implementation
separate from those existing package sources; DX-31 clarifies this placement.

The content mapper shares that source understanding and emits a checking
representation retaining authored types, scopes and expressions. That projection
serves TypeScript tooling; it is not a second production compiler. Compiler-next
continues to produce the application's optimized DOM/SSR output. The checking
projection and application output may differ substantially.

Do not make TypeScript reconstruct the authored program from optimized runtime
output. Conversely, checking-only scaffolding must not dictate production costs.
Runtime source maps and TypeScript span mappings are separate artifacts.

The [checking-flow profile](wiki2/checking-flow.md) now clears the four original
gaps where ordinary TypeScript narrowing misdescribed reactive evaluations.
All 34 current LSP targets pass. A primary TSX view retains editor identity
and ordinary narrowing; compiler facts select regions checked in a supplemental
view. Its generated scaffolding has no authored edit span, and its mappings
disable editor edits. Native TypeScript still checks the delegated regions.
The public snapshot supplies existing graph facts, not complete replay proofs.
Compiler-owned files are grouped in `packages/compiler-next/src/analysis/`;
extended syntax and checking transformations remain in JSX+. Broader flow,
lowering, editor and module coverage remain open. Receiving declarations and JSX
opening elements participate in diagnostic routing, retaining native assignment
errors. Typed identity calls validate copied seeds before widening, including
captured derivations and direct body assignments; they never become runtime code.

Keep the mapper lightweight: parse and generate the needed checking representation,
cache by source and relevant configuration, and avoid building the complete DOM
runtime output after every keystroke.

The first bounded cache now keeps one latest exact filename/source result per
open project and discards it on close/reopen. [Cache evidence](wiki2/mapper-cache.md)
uses the actual [task-board example](packages/jsx-plus/examples/task-board/App.auwla),
not fabricated projection output. That example also has a local browser preview,
native mapper configuration and runtime interaction checks. Its footer uses
standard backtick `${...}` interpolation; ordinary quoted children stay strings.

Use explicit imports such as `./Counter.auwla` in the first prototype. Registration
of a mapper must not be assumed to enable extensionless lookup; Microsoft marked
that expectation as working as intended in [this resolution issue][ts-resolution].

Open: extension choice, mapper packaging, declaration output, incomplete-source
recovery and the supported TypeScript/editor version matrix.

## 4. Events: lazy expressions and function handlers

The core proposal is:

```tsx
<button @click={count++}>"Add"</button>
<button @click.shift={count += 10}>"Add ten"</button>
<form @submit.prevent={add()}><Fields /></form>
```

`@` visibly establishes an event context. Ordinary JSX props retain their existing
evaluation rules; the compiler must not lazily evaluate every prop that looks like
a call.

### 4.1 Forms that must have a stated meaning

| Form | Recommended interpretation | Decision status |
| --- | --- | --- |
| `@click={count++}` | Evaluate the expression on each accepted event | Proposed |
| `@click={save()}` | Call `save` on each accepted event | Proposed |
| `@click={save}` | Invoke the referenced function with the event | Proposed |
| `@click={(event) => save(event)}` | Invoke the authored function | Proposed |
| `@click={makeHandler()}` | Call the factory on the event; do not implicitly invoke its return value | Proposed; important ambiguity |
| `@click={object.save}` | Specify receiver preservation and when the member is read | Open |
| `@click={enabled ? save : cancel}` | Decide whether a function result is invoked or merely produced | Open |
| `@click={await save()}` | Decide whether top-level handler expressions permit `await` | Open |

The first four forms have useful precedent in [Vue's event handling][vue-events].
However, we must not accumulate undocumented rules based only on expression shape.
Before adopting implicit function invocation, test conditional functions, getters,
optional calls, bound methods and factories.

An explicit arrow is the general form for complex behavior:

```tsx
<button @click={async (event) => {
  const result = await save();
  report(result, event);
}}>
  "Save"
</button>
```

### 4.2 Event names, scope and types

The original proposal introduces `e` implicitly. This saves characters but can
shadow ordinary code:

```tsx
const e = selectedEntry;
// Does this refer to the entry or the event?
<button @click={inspect(e)}>"Inspect"</button>
```

Recommendation: always support an explicit event parameter. If an implicit name
is added, choose it deliberately and document its scope and shadowing behavior.
`$event` is an option for discussion, not an accepted spelling.

The checking representation must infer the event and owning element types without
making `event.target` falsely appear to be the owning element. Custom DOM events
need an extensible typing mechanism; unknown event names must remain usable.

Specify the difference between a component callback prop and a DOM custom event.
`onPick={handler}` and `@picked={handler}` must not become interchangeable by accident.

## 5. Modifiers: order, evaluation and asynchronous boundaries

Candidate modifiers fall into different semantic groups:

| Group | Examples | Required behavior |
| --- | --- | --- |
| Listener configuration | `.capture`, `.passive`, `.once` | Define installation, conflicts and removal |
| Guards | `.self`, `.shift`, `.esc`, `.if(condition)` | Define whether they stop the remaining chain |
| Dispatch-time effects | `.prevent`, `.stop` | Run while native dispatch is active |
| Timing | `.debounce(300)`, `.throttle(100)`, `.cooldown(1000)` | Own timers and define leading/trailing behavior |
| Actions | `.log(...)`, `.emit(...)`, `.flag(...)` | Define execution order and side effects |

### 5.1 Order is observable

```tsx
@click.self.prevent={save()}
@click.prevent.self={save()}
```

These can differ: should a child-originated click have its default action prevented
before a guard rejects the handler? Vue documents ordered modifier behavior. We
should explicitly choose whether Auwla follows that model.

Do not assume `.stop` has identical semantics across frameworks. Imba's event
implementation uses immediate propagation stopping in its `stop` handling. Decide
whether Auwla means `stopPropagation()` or `stopImmediatePropagation()` and expose
the other operation explicitly if needed. See [Imba's implementation][imba-events].

### 5.2 Timing needs more than a duration

For each timing modifier, specify:

- Whether the first event runs immediately.
- Whether the last suppressed event runs later.
- Whether the interval starts at event receipt, handler start or completion.
- What happens when the handler returns a promise.
- Whether a changed duration affects pending work.
- Whether a new event replaces or queues pending work.
- What happens when the owner disappears or a keyed row moves.

Recommendation: pending timers belong to the mounted owner; disposing it cancels
pending work. Moving an existing row preserves its timer state.

### 5.3 Native event operations cannot be delayed arbitrarily

```tsx
<form @submit.prevent.debounce(300)={save()}><Fields /></form>
```

Preventing default submission must occur during dispatch. A later timer callback
cannot retroactively prevent it. Define what happens if `.prevent` appears after
a timing modifier: reject that framework-specific combination, normalize it under
an explicit rule, or require a particular order. Do not silently change its meaning.

Native `event.currentTarget` becomes `null` outside dispatch. A delayed handler
must not receive a type or promise that contradicts this. Consider a separately
captured owning-element value; keep native event semantics intact. See [MDN's
description][current-target], which links the DOM specification.

### 5.4 When modifier arguments run

```tsx
@click.if(enabled)={save()}
@input.debounce(delay)={search(query)}
@click.emit("picked", item)
```

Decide which arguments are setup configuration, reactive configuration, or
event-time expressions. If a guard captures `enabled` only at mount, it can become
stale. If arbitrary calls are replayed to refresh configuration, their side effects
can repeat unexpectedly. Specify each category before compiling it.

## 6. Bindings: writable targets and element behavior

The proposed convenience forms are:

```tsx
<input bind={draft} />
<input type="checkbox" bind={todo.done} />
```

Recommendation: retain the possibility of convenient defaults, and support named
bindings for cases where the property matters:

```tsx
<input bind:value={draft} />
<input type="checkbox" bind:checked={todo.done} />
```

Svelte's [binding documentation][svelte-bind] is useful prior art for writable
targets, property-specific bindings, numeric input and form reset behavior. Its
exact rules are not automatically Auwla's rules.

### 6.1 Binding matrix to settle

| Element or value | Question |
| --- | --- |
| Text input and textarea | Default property, input event and composition behavior |
| Checkbox | Boolean checked state versus membership in a collection |
| Radio input | Group ownership and matching value |
| Number and range input | String versus number; empty and invalid values |
| Select, including multiple | Value type and option matching |
| File input | Supported direction and writable constraints |
| Custom component | Property and change callback contract |
| Dynamic input type | Whether a changed type changes the binding contract |
| Form reset | Whether and when state follows the browser reset |
| Server-rendered input | Initial value and hydration reconciliation |

### 6.2 Binding writes use ordinary assignment semantics

`bind:checked={todo.done}` writes the property; it does not reassign `todo`.
`bind:value={draft}` reassigns `draft`. A read-only binding, readonly property or
non-assignable expression must produce a useful diagnostic.

The virtual TypeScript should check both the read and the actual write, preserving
the authored target's type and writability. Checking only a getter is insufficient.
Computed targets must preserve evaluation count and order; do not duplicate an
expression such as `getModel()[getKey()]` during one write.

### 6.3 Ordering with authored handlers

```tsx
<input bind={query} @input.debounce(300)={run(query)} />
```

Recommendation: update the binding before running the authored handler. Document
this as an Auwla choice; other frameworks have different ordering. Also distinguish
the query read at event receipt from the query read when a delayed handler runs.

### 6.4 Button selection deserves a separate decision

The original proposal uses:

```tsx
<button bind={filter} value="active">"Active"</button>
```

This implies assignment on click and an automatically applied `active` class.
It combines a selection feature with binding and styling conventions.

Recommended baseline:

```tsx
<button
  type="button"
  .active={filter === "active"}
  @click={filter = "active"}
>
  "Active"
</button>
```

If selected-value binding is valuable, design it as a named feature with rules for
value equality, accessibility state, classes, disabled elements and components.

## 7. Conditional classes and inline styles

The proposed `.done={todo.done}` form is concise and visually tied to classes.
`class:done={todo.done}` is an alternative. Neither spelling is settled.

```tsx
<li class="todo" .done={todo.done}>todo.title</li>
<div style:transform={`translate(${pos.x}px, ${pos.y}px)`}><Content /></div>
```

Specify merge order with ordinary `class`, `style`, spreads and imperative edits.
An unrelated update should not erase an imperative class unless the declarative
site owns that class. Define what happens when two declarative sites or an observer
both control the same class token.

For styles, define CSS custom properties, property naming, removal on nullish
values, units and priority. Do not infer a complete styling language from one
`transform` example.

## 8. Code in markup bodies, text and keyed identity

Accepted prototype direction: literal text is quoted, expressions are read
directly, and control flow needs no outer expression container:

```tsx
<section>
  <h1>"Tasks"</h1>

  if (todos.length === 0) {
    <p>"Nothing to do."</p>
  } else {
    <ul>
      visible.map(todo => <TodoRow key={todo.id} todo={todo} />)
    </ul>
  }
</section>
```

`<p>message</p>` reads a binding; `<p>"message"</p>` displays literal text.
Arithmetic, calls, chains, template literals and ternaries remain expressions:

```tsx
<p>count + 1</p>
<p>"Hello, " + user.name</p>
<p>`Remaining: ${left}`</p>
<section>empty ? <Empty /> : <Content /></section>
```

The quotes delimit the source string and are not displayed. Escaping, multiline
text, whitespace and HTML-entity behavior need explicit examples.

Direct loops are a candidate form under this direction:

```tsx
<ul>
  for (const todo of visible) {
    <TodoRow key={todo.id} todo={todo} />
  }
</ul>
```

Loop grammar and the exact key contract remain open. The earlier `key todo.id`
loop suffix is not the baseline; the example uses the existing `key` prop.

These are markup-body constructs. Ordinary JavaScript blocks outside markup do
not start rendering their expression statements. How bodies collect children,
preserve lexical scope and lower into existing regions must be specified and
tested. No new state or scheduling system follows from the new surface syntax.

Questions to settle in [wiki2/syntax.md](wiki2/syntax.md):

The [core grammar draft](wiki2/spec/grammar.md) now supplies a first concrete
answer for expression boundaries and block-bodied conditionals. Remaining
questions below cover later profiles and revisions; they do not make the current
draft implicit or exempt its implementation from conformance checks.

- Where do adjacent expressions end? Newlines, semicolons and JavaScript ASI
  must be tested with calls, indexing, comparisons and nested tags. Semicolons
  are a candidate separator, not an accepted mandatory rule.
- How are closing tags distinguished from operators, generics and regular
  expressions, including while the source is incomplete?
- Where can blocks occur: children, fragments, stored markup and returns?
- Can bodies declare locals or produce several siblings? What owns those locals
  on replay, and how do branch and row scopes map into TypeScript?
- How do `else if`, destructuring, indices and empty-list output work?
- What do `break`, `continue` and `return` mean inside a markup block?
- Are legacy child expression containers accepted in the new format? Existing
  TSX keeps its current behavior regardless of that choice.
- What is the key contract for omission, duplicate keys, changes and objects?
- How are row closures, refs, timers and local state preserved on moves?

Stable record IDs remain the example keys. Direct loops and `.map()` must both
preserve ordinary expression evaluation order and use the existing list machinery.

## 9. Hotkeys: scope, activation and conflicts

The proposal includes element defaults and explicit handlers:

```tsx
<input @hotkey("/") placeholder="Search..." />
<button @hotkey("mod+s") @click={save(text)}>"Save"</button>
```

Imba has real implementation precedent for focusing input-like elements and
clicking other elements. Its [hotkey implementation][imba-hotkeys] also contains
editable-field filtering and grouping. Those details matter to the design.

Recommended lifecycle: the mounted element or region owns the registration.
Removal unregisters it; moving the same keyed owner does not create a duplicate.

Open behavior:

- `mod` platform mapping and keyboard-layout handling.
- Logical key versus physical key code.
- Editable fields, contenteditable and input composition.
- Repeat events, disabled elements and hidden owners.
- Focus scope, modal priority and multiple matching shortcuts.
- Browser-default prevention and whether the original key event is available.
- Whether automatic activation uses native `.click()` behavior.
- Reactive changes to the shortcut expression.

A hidden node carrying shortcuts may be supported, but `hidden` must not silently
mean both active and inactive in different examples. A structural condition is a
clear ownership boundary:

```tsx
<section>
  if (selected !== null) {
    <div hidden @hotkey("esc")={selected = null} />
  }
</section>
```

Type checking must account for deferred execution. A condition that was true when
markup was created does not automatically prove that a mutable value is still
non-null inside a later asynchronous callback.

## 10. Dragging and gesture behavior

Original proposal:

```tsx
<div
  class="box"
  style:transform={`translate(${pos.x}px, ${pos.y}px)`}
  @touch.moved(4).sync(pos)
>
  props.label
</div>
```

Imba's [touch implementation][imba-touch] uses pointer events and defines `.sync`
relative to an initial value and pointer position. Auwla should state its own
coordinate contract rather than call every interpretation "drag offset".

Decide:

- Whether the public feature is named `touch`, `drag` or something else.
- Pointer types, primary-button handling, capture and cancellation.
- Whether the threshold is measured from pointer down or a later activation point.
- Whether the movement crossing the threshold contributes to the first update.
- Coordinate space, scrolling, transforms and existing non-zero positions.
- What happens if `pos` is replaced during an active drag.
- How multiple pointers and competing nested gestures are handled.
- Touch scrolling, text selection and click suppression.
- Cleanup when the owner disappears before pointer up.

`.sync(pos)` must use the established reactive mutation path. It must not need a
second state system, a proxy requirement or a deep snapshot per pointer move when
the written fields are known. Any such optimization still needs correctness gates.

A low-level pointer-event path remains available for gestures the convenience
does not express.

## 11. Intersection and other observers

Original proposal:

```tsx
<div class="card" @intersect.flag("visible")>item</div>
```

Choose whether `.flag("visible")` means visibility state or a temporary marker
while an event handler runs. Imba's generic event `.flag` is a duration marker;
that alone does not establish the behavior of its intersection-specific feature.
The research here did not verify that specialized implementation.

An explicit alternative for discussion is:

```tsx
<div
  class="card"
  .visible={visible}
  @intersect={(entry) => visible = entry.isIntersecting}
>
  item
</div>
```

Here `visible` must belong to the appropriate component or row. Do not accidentally
share one boolean across all list items. The observer callback argument type and
spelling above are proposed.

Define threshold, root, root margin, initial notification, enter/leave behavior,
one-shot observation and server-rendered initial state. Ownership ends observation
on disposal. Observers with compatible options may share a runtime observer if
that preserves semantics; do not assume one observer per element is necessary.

## 12. Element references

Accepted: keep normal variable declarations and the existing `ref` prop. Do not
introduce tag-declared bindings or a `$` naming convention for refs.

**Refs are already built in compiler-next.** This proposal adds no ref system.
Only the surrounding new markup syntax needs support; the existing ref path and
its compatibility checks carry over.

```tsx
export function Editor() {
  let input: HTMLInputElement | undefined;

  return (
    <section>
      <input ref={input} />
      <button onClick={() => input?.focus()}>"Focus the input"</button>
    </section>
  );
}
```

The existing compiler writes the element on mount and `undefined` on removal.
Refs stay reactive on mount, replacement and removal. Ordinary variable scope,
shadowing, member targets and the current callback/forwarding contracts carry
over. This decision concerns refs; existing framework APIs such as `$fetch` are
unaffected. See [wiki2/refs.md](wiki2/refs.md) for the code map and checks.

The chat example still needs an explicit DOM-update timing contract:

```ts
messages = [...messages, nextMessage];
if (log) log.scrollTop = log.scrollHeight;
```

Here `log` was normally declared and connected with `ref={log}`. If DOM updates
settle after this synchronous stretch, `scrollHeight` can still be the old height.
Demonstrate a supported post-update mechanism before presenting this as correct
auto-scrolling. A ref does not imply that every DOM measurement forces an update.

## 13. Event delegation and custom events

The original menu uses `.sel("li")` while reading `e.target.textContent`. Imba's
implementation tests `target.matches(...)`; `.closest(...)` is separate. Clicking
a nested icon is therefore different from clicking the `li` itself.

For a row that already has its item, prefer passing that item directly:

```tsx
<ul>
  props.items.map(item => (
    <li key={item.id}>
      <button type="button" @click={props.onPick(item)}>
        item.label
      </button>
    </li>
  ))
</ul>
```

If delegation is offered, define the original target, matched element and listener
owner separately. Bound ancestor search to the container. Specify non-element
targets and shadow DOM behavior; a selector string does not prove an arbitrary
element type to TypeScript.

For `.emit("picked", item)`, define the dispatch origin, `detail`, bubbling,
cancelability, composition across shadow roots, ordering and synchronous re-entry.
Keep component callback props distinct from DOM custom events.

## 14. File-scoped CSS and server rendering

A top-level style block is proposed:

```tsx
<style>
  .card { padding: 1rem; }
</style>

export function Card() {
  return <article class="card"><Content /></article>;
}
```

Define the scope instead of relying on the phrase "file-scoped":

- Does one style block affect every component exported by the file?
- Does a parent selector reach a child component's root or its internals?
- What are the explicit global and deep-selector escape hatches?
- Are nested styles, media queries, keyframes and preprocessors supported?
- Are dynamic values expressed through CSS variables or another mechanism?
- How are scope identifiers kept stable across SSR and client compilation?
- How are CSS output, ordering, deduplication and hot updates handled?

Server rendering must not register document hotkeys, start pointer listeners or
construct browser observers. It must still emit the correct initial classes,
values and styles. Hydration must establish each resource exactly once.

The content mapper does not supply this CSS or runtime implementation.

## 15. Asynchronous search: reactivity and request ordering

The original example assigns results after a fetch:

```ts
async function run(query: string) {
  results = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
    .then(response => response.json());
}
```

The assignment updating the UI is one contract. Preventing an older response from
overwriting newer results is another. Debounce does not solve response ordering.

A plain JavaScript latest-request example:

```ts
let latestRequest = 0;

async function run(query: string) {
  const request = ++latestRequest;
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const nextResults: string[] = await response.json();

  if (request === latestRequest) {
    results = nextResults;
  }
}
```

This defines "latest" as the latest invocation of `run`, not the latest keystroke.
If input changes during a debounce window, decide whether already-running results
remain eligible. Cancellation, pending state, error state and disposal are also
separate questions. The annotation above is not runtime response validation.

Where appropriate, prefer illustrating the existing source/readiness model once
its refresh and stale-response guarantees have been verified. Do not invent an
unimplemented `$fetch` option just to make the example shorter.

## 16. A revised example to discuss

This example combines proposed syntax while keeping actions visible. It is not a
claim that the parser currently accepts the file.

```tsx
type Todo = { id: number; title: string; done: boolean };
type Filter = "all" | "active" | "done";

export function Todos() {
  const todos: Todo[] = [];
  let nextId = 0;
  let draft = "";
  let filter: Filter = "all";

  const visible = todos.filter(todo =>
    filter === "all" || (filter === "done" ? todo.done : !todo.done));
  const left = todos.filter(todo => !todo.done).length;

  function add() {
    const title = draft.trim();

    if (!title) return;

    todos.push({ id: nextId++, title, done: false });
    draft = "";
  }

  function remove(todo: Todo) {
    const index = todos.indexOf(todo);

    if (index >= 0) todos.splice(index, 1);
  }

  return (
    <main>
      <form @submit.prevent={add()}>
        <label>
          "New task";
          <input bind:value={draft} @keydown.esc={draft = ""} />
        </label>
        <button type="submit">"Add"</button>
      </form>

      <ul>
        visible.map(todo => (
          <li key={todo.id} .done={todo.done}>
            <label>
              <input type="checkbox" bind:checked={todo.done} />
              <span>todo.title</span>
            </label>
            <button type="button" @click={remove(todo)}>"Remove"</button>
          </li>
        ))
      </ul>

      if (todos.length === 0) {
        <p>"Nothing to do."</p>
      } else {
        <footer>
          <span>left + " left"</span>
          <button type="button" .active={filter === "all"}
            @click={filter = "all"}>"All"</button>
          <button type="button" .active={filter === "active"}
            @click={filter = "active"}>"Active"</button>
          <button type="button" .active={filter === "done"}
            @click={filter = "done"}>"Done"</button>
        </footer>
      }
    </main>
  );
}
```

The `const todos` intentionally demonstrates mutation without reassignment.
`visible` and `left` intentionally demonstrate derived `const` bindings. Neither
declaration keyword introduces a new reactive rule. IDs are component-local and
monotonic for this example; persistence and shared data require another ID policy.

## 17. Decision register

This is the design index. Detailed contracts and cases live on the linked
[wiki2 concept pages](wiki2/README.md); dated user decisions live in
[wiki2/decisions.md](wiki2/decisions.md). Leave recommendations open until accepted,
and mark a revised decision as superseded rather than erasing its reason.

| ID | Decision | Current position | Status |
| --- | --- | --- | --- |
| DX-01 | TypeScript integration | Use the new content mapper API | User-specified; initial CLI/LSP diagnostic/ref-rename probe built; broader integration open |
| DX-02 | Source extension | `.auwla` in examples | Open |
| DX-03 | Parser architecture | Shared source-aware parser for checking and runtime compilation | Recommended |
| DX-04 | Lazy event expressions | `@event={expression}` runs on the event | Proposed |
| DX-05 | Function-valued handlers | References and arrows supported; factory/conditional cases need precise rules | Open |
| DX-06 | Implicit event variable | Explicit parameters supported; avoid accidental `e` shadowing | Open |
| DX-07 | Modifier order | Specify guards, side effects and listener options | Open |
| DX-08 | Modifier argument timing | Distinguish setup, reactive configuration and event-time reads | Open |
| DX-09 | Timing behavior | Specify leading/trailing, overlap and disposal | Open |
| DX-10 | Bind syntax | Convenient defaults plus `bind:property` | Recommended |
| DX-11 | Bind/event order | Binding write before authored handler | Recommended |
| DX-12 | Selected buttons | Explicit assignment and class as baseline | Recommended |
| DX-13 | Class/style syntax | `.class` versus `class:class`; merge and ownership rules | Open |
| DX-14 | Markup control flow | Direct `if` and loop exploration without an outer child-expression container; keep `.map()` | Accepted direction; grammar open |
| DX-15 | Key contract | Identity, duplicates, omission and resource preservation | Open |
| DX-16 | Hotkeys | Element/region ownership, explicit scope and conflict rules | Proposed |
| DX-17 | Gesture API | `touch` versus `drag`; coordinate and cancellation rules | Open |
| DX-18 | Observer API | Distinguish visibility state from temporary event flags | Open |
| DX-19 | Refs | Normal variable declarations plus `ref={target}`; no tag declarations or `$` ref convention | Accepted; replaces shorthand proposal |
| DX-20 | CSS scope | File/component boundaries and SSR output | Open |
| DX-21 | Custom events | Dispatch, detail, typing and component callback distinction | Open |
| DX-22 | Async examples | State updates and request ordering documented separately | Recommended |
| DX-23 | Post-update DOM work | Correct chat scrolling and measurements | Open |
| DX-24 | Formatting and CSS tooling | Explicit support plan beyond TypeScript mappings | Open |
| DX-25 | Text and expression children | Quoted text; direct JavaScript expressions without child-container braces | Accepted direction; grammar open |
| DX-26 | Grammar boundaries | Core spec revision 1 supplies provisional rules; extended behavior and later profiles remain open | Draft to test and revise |
| DX-27 | Iteration | Small slices; revise the plan, examples and decisions as we learn | Accepted |
| DX-28 | Compiler continuity | Extend compiler-next's existing pipeline; refs and other existing features are reused | Accepted |
| DX-29 | Spec before implementation | Define grammar, syntax model, semantics, diagnostics and conformance fixtures before the parser; evolve the draft explicitly | Accepted |
| DX-30 | Backend authoring | Pure, nonreactive backend code in configured `.auwla` files/folders; ordinary backend imports; isomorphic support later | Accepted direction; implementation/config syntax planned |
| DX-31 | Package boundary | Keep syntax/normalization in `packages/jsx-plus`; delegate production compilation to compiler-next's public API | Accepted; supersedes earlier in-place placement |
| DX-32 | Parenthesized attribute values | Allow `prop=(expression)` alongside existing braces, with ordinary JSX value/event timing | Accepted; spec 0.1 revision 2 |

## 18. Suggested prototype and acceptance examples

The initial specification and syntax package now exist. The first package slice
normalizes quoted text, expressions, basic direct `if` and `.map()` into TSX,
with authored mappings and compilation through compiler-next. Current fixtures
verify existing refs and keyed nodes. Further grammar hardening and the TypeScript
mapper follow; module-graph/Vite, delivery and backend config integration are later
work. Add event/binding conveniences after their contracts are settled.

The working order and evidence live in [wiki2/plan.md](wiki2/plan.md) and
[wiki2/status.md](wiki2/status.md). Reorder or replace an experiment when evidence
changes the next useful step. A completed prototype slice does not by itself
establish production adoption or compiler performance acceptance.

### TypeScript and editor checks

- Correct event types and element ownership; no falsely narrowed `target`.
- A deliberate wrong handler argument reports at the authored argument.
- Binding to a const scalar or readonly property reports at the authored target.
- Component props, generics and imports retain inference.
- Rename reaches declarations, markup, binding targets and handler bodies.
- Completion and auto-import edits produce valid `.auwla` source.
- Branch and row scopes do not leak bindings.
- Deferred callbacks do not receive unsafe narrowing from mount-time conditions.
- Incomplete syntax recovers without losing tooling for the rest of the file.
- Repeated edits stay responsive on the user's low-memory machine.

### Runtime and lifecycle checks

- No event expression runs during setup, SSR or an unrelated update.
- A plain callback form and shorthand produce equivalent writes and updates.
- Binding writes and authored handlers observe the documented order.
- A keyed row move preserves refs, timers and local state without duplication.
- Removing a row cancels timers and unregisters hotkeys/observers.
- A drag ending through cancellation or disposal releases its resources.
- Classes and styles obey the chosen merge and ownership rules.
- A delayed callback observes the documented state and native event behavior.
- Async search cannot publish stale results under the chosen ordering policy.
- SSR and hydration agree on initial values, classes and resource ownership.

Use focused differential cases against ordinary JavaScript/JSX forms where there
is a real equivalent. Compare output size and representative creation/update/list
costs before claiming that a syntax form improves performance. A resource-owning
feature must be tested through disposal, not only through its first successful use.

## 19. Sources and research limits

Research date: 2026-11-05. TypeScript 7.1 was in beta in the announcement consulted.
API and editor behavior should be rechecked against the pinned prototype version.

- [TypeScript 7.1 beta announcement][ts-announcement]: official release context,
  registration and permissions.
- [Content mapper implementing PR][ts-mappers]: protocol, virtual output, span
  mappings and mapped language-service limitations.
- [Microsoft extensionless-resolution issue][ts-resolution]: why registration
  should not be treated as automatic extensionless lookup.
- [Vue event handling][vue-events]: inline expressions, function handlers and
  ordered modifier behavior as prior art.
- [Svelte bindings][svelte-bind]: writable targets and property-specific binding
  behavior as prior art.
- [Imba event runtime][imba-events]: target matching, modifier implementation and
  generic event flags. This source does not prove intersection-specific behavior.
- [Imba hotkey runtime][imba-hotkeys]: default activation, editable fields and scopes.
- [Imba touch runtime][imba-touch]: pointer-backed gestures and relative sync.
- [Event.currentTarget][current-target]: native dispatch lifetime; includes a link
  to the DOM specification.

The architecture, recommendations and prototype order are Auwla design proposals
derived from those sources. They are not statements that the sources prescribe
this design, or that any of the proposed JSX+ features are already implemented.

[ts-announcement]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/
[ts-mappers]: https://github.com/microsoft/typescript-go/pull/4712
[ts-resolution]: https://github.com/microsoft/TypeScript/issues/64546
[vue-events]: https://vuejs.org/guide/essentials/event-handling.html
[svelte-bind]: https://svelte.dev/docs/svelte/bind
[imba-events]: https://github.com/imba/imba/blob/main/packages/imba/src/imba/events/core.imba
[imba-hotkeys]: https://github.com/imba/imba/blob/main/packages/imba/src/imba/events/hotkey.imba
[imba-touch]: https://github.com/imba/imba/blob/main/packages/imba/src/imba/events/touch.imba
[current-target]: https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget
