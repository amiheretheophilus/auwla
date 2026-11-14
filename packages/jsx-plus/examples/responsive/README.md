# Numeric responsive styles

From `packages/jsx-plus`, run `bun run examples/responsive/preview.ts` and open
`http://127.0.0.1:3036`. Add `--build` for a build-only check. Compiler-next and
its existing Bun adapter own the HTML, CSS and JavaScript delivery.

Resize the viewport around 300px, 700px and 1000px. `@700` and `@700px` mean the
same inclusive minimum viewport width. App's grid changes from one column to
two, then three. Its CSS-generated viewport label needs no JavaScript listener.
`@40rem` shows an explicit relative threshold, with no configured breakpoint names.

Card imports a named style definition from `shared.auwla`; each card gets its
component scope. App's intentionally conflicting `.card` rule must not leak into
it. The nested heading responds at 700px. Toggle each card's expansion independently:
the `.expanded` clause wins through ordinary class specificity at every width.
The order-check paragraph intentionally puts `@300` after `@700`; it keeps 12px
padding above 700px because queries are never sorted by the compiler.

App deliberately declares `:root` theme variables and `body` typography in the
same local block as its component rules. Explicit document targets stay reachable;
ordinary subjects remain scoped. The root button color makes card buttons visible.

Thresholds support no unit (pixels), `px`, `em` and `rem`. Values use native CSS
units without any scale. Grouped numeric blocks, named breakpoints, maximum/range
shorthands and property aliases remain future work; native media queries work today.
