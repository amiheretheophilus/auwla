# Native CSS

`App.auwla` authors two static `<style global>` blocks and ordinary component
code. CSS uses native declarations, custom properties, a same-element `.loading`
selector, hover and media queries. The click handler changes an ordinary class;
it does not execute the stylesheet.

Run `bun run packages/jsx-plus/examples/styling/preview.ts` from the repository
root, then open the printed URL. Add `--build` for a build-only check. The shared
preview uses compiler-next's Bun plugin with `languages: [auwla]`.

The preview gives Bun the HTML entry, so Bun writes the stylesheet and script
links itself. Vite supplies stylesheet delivery from the same generated import.
Local scoping, compact conditions and aliases are later slices. This example is
deliberately global and uses the existing class attribute syntax.
