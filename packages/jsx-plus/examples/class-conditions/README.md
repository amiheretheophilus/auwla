# Compact class conditions

Run `bun run packages/jsx-plus/examples/class-conditions/preview.ts` from the
repository root and open port 3034. Add `--build` for a build-only check.

The three buttons change ordinary classes. `App.auwla` uses full CSS properties
with `@.loading`, `@.error` and `@.expanded` values. The compiler emits native class
selectors and the browser applies them; no styling runtime is added. When both
loading and error match, error's later equal-specificity rule wins.

The pseudo-element example tests that the class belongs to `.card` itself.
Breakpoints, grouped conditions, property aliases and local scoping are later
slices. See `wiki2/spec/style-conditions.md` for the provisional CSS-2a contract.
