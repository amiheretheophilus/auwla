# CSS shorthands: authored definitions and compound styles

Design draft, 2026-11-15. **Documentation only; not implemented.** DX-52 records
the accepted direction. The `@define` spelling and constraint notation below
remain proposed syntax. This extends the existing CSS layer in JSX+, using
compiler-next's existing CSS delivery.

## Accepted direction

- Authors write reusable shorthand definitions as style code. Teams can share,
  extend and override those definitions to choose what names such as `p` mean.
- A definition accepts a value and emits one or several native CSS declarations.
  Its body can mix fixed declarations with declarations using that value.
- Definitions can restrict the accepted values. Compiler validation and editor
  suggestions must use the same definition.
- Shorthands work with existing compact responsive/class conditions and grouped
  responsive rules. Conditions apply to the entire expansion.
- Expansion produces static CSS. No JavaScript configuration table, value-scale
  system, Tailwind dependency or styling runtime is required by this design.

## Proposed definition syntax

```css
@define p(value: 4px | 8px | 16px | 24px) {
  padding: value;
}

@define a(value: start | center | end) {
  display: flex;
  align-items: value;
  justify-content: value;
}

@define measure(value: <length-percentage>) {
  width: value;
}
```

In this candidate, `value` is the compiler parameter. Its references in the body
are substituted with the supplied CSS value. Exact substitution boundaries,
escaping and literal identifier collisions still need a grammar contract; this
is not textual replacement inside strings, comments or URLs.

`p:16px` expands to `padding:16px`. `p:12px` is rejected by this particular
definition, even though `12px` is a valid native padding value. `a:center` emits
all three declarations in its body. `a:diagonal` is rejected. `measure:50%` and
`measure:20rem` illustrate a broader CSS value constraint. These are proposed
compiler/editor outcomes, not passing conformance cases yet.

Values are CSS values. `p:4` does not silently become `4px`, `16px` or a token
lookup. Any future numeric conversion needs a separate explicit rule. The `a`
example aligns the element's children; authors can define item alignment using
`align-self`/`justify-self` instead.

## Responsive and class conditions

```css
.item {
  a:center @700:start;
}
```

Expected native CSS, shown before existing local-scope markers:

```css
.item {
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (min-width: 700px) {
  .item {
    display: flex;
    align-items: start;
    justify-content: start;
  }
}
```

Every value is checked against the same definition. The responsive branch
includes fixed declarations such as `display:flex` as well as substituted ones.
`@700px` is equivalent to `@700`; the existing [numeric threshold grammar](style-responsive.md)
and [group grammar](style-groups.md) remain the source of truth.

```css
.item {
  a:center @700:start @.loading:end;

  @900px {
    a:center;

    &.expanded {
      a:end;
    }
  }
}
```

The first chain keeps the existing independent-alternative meaning: the width
branch is minimum viewport width 700px; the class branch targets this same
element with `.loading`. It does not mean "loading only above 700px". To combine
those conditions, put the compact class clause inside the numeric group:

```css
.item {
  @700 {
    a:center @.loading:end;
  }
}
```

Both expansions then inherit the minimum width. Preserve authored declaration,
clause and definition-body order, existing specificity, layers and final
declaration-level `!important`. Do not sort breakpoints or add runtime handlers.
Ordinary native declarations can appear before and after a shorthand; the
expanded declarations participate in the normal CSS cascade at that position.
Class groups continue to use `&.expanded`, not `@.expanded { ... }` (DX-50).

## Extending and overriding

A team may provide this different meaning for `p`:

```css
@define p(value: 8px | 16px | 32px) {
  padding-inline: value;
}
```

The active definition determines both output properties and accepted values.
Sharing is intended to use authored styles. Import/export spelling, definition
visibility, explicit override syntax and duplicate-name resolution remain open;
this draft does not silently make existing `@use(path, id)` transport definitions
or choose a last-import-wins rule. Selector scope and definition visibility are
separate concerns; component/file/global CSS keeps its current scope contract.

## Before implementation

Resolve the smallest usable definition grammar, parameter substitution, allowed
definition-body contents, visibility/imports/overrides and native-property name
collisions. Decide how literal constraints, CSS type expressions, `calc()`,
`var()`/`env()`, CSS-wide keywords and resulting native property restrictions
interact. The compiler can check static references but cannot prove every value
that a browser will resolve dynamically. Do not invent implicit conversions.

Then add self-contained cases for single/compound output, rejected values in
every conditional branch, compact/grouped equivalence, class/width intersections,
override visibility, cascade/importance, lexical boundaries and authored ranges.
Tooling must suggest active definitions/accepted values and explain generated
properties on hover. Keep those services shared across editor adapters.

Implementation belongs under `packages/jsx-plus/src/styles/`, using the shared
CSS syntax model and existing compiler-owned stylesheet delivery. Add a freely
editable authoring example separately from test fixtures. This document records
the requested design; it does not authorize implementing the unresolved choices.
