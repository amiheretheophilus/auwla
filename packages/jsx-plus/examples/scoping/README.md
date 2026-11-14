# Component style gallery

From `packages/jsx-plus`, run `bun run examples/scoping/preview.ts` and open
`http://127.0.0.1:3035`. Add `--build` to check the HTML/CSS build without serving.

Read `Cards.auwla`: two components reuse a named style through
`@use("./Cards.auwla", "card-look")`, which itself uses `card-frame` from
`styles/Frames.auwla`, then `palette` from `styles/Palette.auwla`. The named
rules acquire each consumer's private scope. Expand either card: its normal
`expanded` class selects native CSS padding while the other card stays compact.
The file-level style shares note weight and heading spacing within that file.

`App.auwla` uses the same `.title` name. Its maroon rule styles its heading,
while the teal, gold and independent purple headings keep their own colors.
The unstyled nested component also excludes App's private marker. File styles
from `Cards.auwla` do not reach `IndependentCard.auwla` or App's note.

This example uses existing compiler-next projects and bundler delivery. CSS
contains static selectors; no styling runtime, Tailwind or per-instance style
elements are involved. `IndependentCard.auwla` also uses the shared frame under
its own scope. The shared rules include ordinary implicit nesting, including
`h2:hover`, and a relative SVG URL. App reuses a named global reset containing a
native CSS import; both resource paths keep the definition's directory.

Edit `styles/Frames.auwla` in Vite: both consumers' CSS updates without replacing
their component programs. These files are source-only dependencies, so their
JavaScript imports/code are not executed by a style use. Named resource rules
such as keyframes still require an explicit global consumer. See the CSS-3b
contract in `wiki2/spec/style-reuse.md`.
