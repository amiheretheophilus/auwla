# Grouped responsive CSS

From `packages/jsx-plus`, run `bun run examples/style-groups/preview.ts` and open
`http://127.0.0.1:3037`. Add `--build` to build without serving. The existing
compiler-next Bun adapter owns compilation and CSS delivery.

Read `App.auwla` for a group that changes several grid properties, a top-level
`@1000px` group, descending thresholds and a declaration after a group. Read
`shared.auwla` for nested groups, inherited class clauses and a heading selector.
`Card.auwla` consumes those named rules in its own scope. App deliberately uses
the same `.card` name with a conflicting border to make scope leaks visible.

Resize across 300/700/900/1000px. `@700` and `@700px` are equivalent. The cards
have 24px padding from 700px, then 28px from 900px. Above 700px, each card's
button independently activates its 36px expanded padding. Below 700px that class
clause's enclosing media condition does not match. The reverse-order paragraph
keeps 12px padding above 300px; the final-declaration paragraph always has 16px.

These are native media queries and selectors. No viewport JavaScript is emitted.
The test apps are independent copies under `tests/fixtures/apps/style-groups/`;
editing or deleting this gallery cannot change the automated tests.
