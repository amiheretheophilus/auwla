# Component style gallery

From `packages/jsx-plus`, run `bun run examples/scoping/preview.ts` and open
`http://127.0.0.1:3035`. Add `--build` to check the HTML/CSS build without serving.

Read `Cards.auwla`: two components reuse a named style through
`@use("./Cards.auwla", "card-look")`, which itself uses `card-frame`. The named
rules acquire each consumer's private scope. Expand either card: its normal
`expanded` class selects native CSS padding while the other card stays compact.
The file-level style shares note weight and heading spacing within that file.

`App.auwla` uses the same `.title` name. Its maroon rule styles its heading,
while the teal, gold and independent purple headings keep their own colors.
The unstyled nested component also excludes App's private marker. File styles
from `Cards.auwla` do not reach `IndependentCard.auwla` or App's note.

This example uses existing compiler-next projects and bundler delivery. CSS
contains static selectors; no styling runtime, Tailwind or per-instance style
elements are involved. Cross-file **component imports** work; cross-file named
style reuse is the next slice and is not claimed by this gallery. Named block
IDs are definitions, used through explicit same-file paths without `#` fragments.
Local nested selectors currently require explicit `&`; named resources such as
keyframes require a global consumer. See the provisional CSS-3a scope contract.
