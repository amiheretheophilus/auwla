# Component slots

Component slots let a component place JSX supplied by its caller without
declaring, destructuring, or reading a `children` prop. Lowercase `<slot>` is
compiler syntax: it does not create a DOM element.

## Default slot

```tsx
function Button(props: { disabled?: boolean }) {
  return <button disabled={props.disabled}><slot /></button>;
}

<Button>Save changes</Button>
```

Unmarked content fills the default slot. Content inside the placeholder is a
fallback and is used only when the caller supplies no content for that slot.

```tsx
function Button() {
  return <button><slot>Continue</slot></button>;
}

<Button />            // Continue
<Button>Save</Button> // Save
```

A supplied conditional still counts as supplied content. If it currently
produces nothing, the slot is empty rather than switching to its fallback.

## Named slots

Declare a named insertion point with a static `name`:

```tsx
function Panel() {
  return <section class="panel">
    <header><slot name="header">Untitled</slot></header>
    <main><slot /></main>
    <footer><slot name="actions" /></footer>
  </section>;
}
```

Assign direct children with a static `slot` marker:

```tsx
<Panel>
  <h1 slot="header">Account</h1>

  <p>Update your account information.</p>
  <AccountForm />

  <Button slot="actions">Cancel</Button>
  <Button slot="actions">Save</Button>
</Panel>
```

The compiler consumes the marker. It is not passed as a component prop or
emitted as a DOM attribute. Several children may target the same slot; their
authored order is preserved. Unmarked text and elements belong to the default
slot, while the component decides where each group is rendered.

Slot names are case-sensitive compile-time string literals. Dynamic names are
rejected. The unnamed default slot is written `<slot />`; `name="default"` has
no special meaning.

## Direct-child ownership

The marker assigns the complete direct child:

```tsx
<Panel>
  <div slot="sidebar">
    <Navigation />
    <UserProfile />
  </div>
</Panel>
```

A marker buried inside an ordinary wrapper does not target the outer component
and is rejected. Compiler-recognized conditionals may target a named slot when
every rendered branch has the same static target:

```tsx
<Panel>
  {showActions && <Toolbar slot="actions" />}
</Panel>
```

## Forwarding slots

A wrapper may consume one of its slots while assigning the result to a slot of
an inner component:

```tsx
function DialogFrame() {
  return <Panel>
    <slot name="title" slot="header">Default dialog title</slot>
    <slot />
    <slot name="buttons" slot="actions" />
  </Panel>;
}

<DialogFrame>
  <h1 slot="title">Delete account?</h1>
  <p>This cannot be undone.</p>
  <Button slot="buttons">Cancel</Button>
  <Button slot="buttons">Delete</Button>
</DialogFrame>
```

On a forwarded placeholder, `name` selects the wrapper's incoming slot and
`slot` selects the inner component's destination slot.

## One content model per component

A component may receive nested content through `children` or `<slot>`, but
never both. `children` remains a supported alternative for authors who prefer
the familiar React-style component API. Once a component declares any
`<slot>`, reading `children`,
`props.children`, or an aliased `children` parameter is a compile error.

```tsx
function Broken({ children }: { children: JSX.Child }) {
  return <><slot />{children}</>;
}
```

Likewise, a call may not combine an explicit `children={...}` prop with nested
slot content. Existing components that only interpolate `children` keep their
current behavior.
The same rule applies inside nested helpers and event callbacks, including
reads through a stable alias of `props`. A callback's separate parameter or
local variable also named `props` is not the component's props and is not
rejected by this rule.

Each default or named slot is declared once. A slot name may not collide with
an ordinary component prop. On a slot component, supplying an unknown named
slot or default content when no default slot is declared is a compile error.
Using a dynamic slot name is also a compile error.

The compiler records exported slot declarations so imported components receive
the same validation and editor information. Authors do not import a slot type
or add compiler-private props to their component signatures.
