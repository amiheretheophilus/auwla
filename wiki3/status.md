# Status

Updated: 2026-11-16. Branch: `compiler-rewrite`.

## Where it stands

- Architecture proposed ([architecture.md](architecture.md)); spec revision 1 drafted
  ([spec/](spec/README.md)) with 11 emit and 8 diagnostic fixtures. Nothing is implemented.
- Accepted: the `.auwla.md` extension (DOC-01) and a wiki of its own (DOC-02).
- Waiting on the user ([decisions](decisions.md#open)): the micromark dependencies, the brace
  rule, metadata, the comment form.

## Evidence so far

Scratch tests in `tests/fixtures/out/perf/` (ignored), 2026-11-16:

- `mdx-shape.test.ts`: MDX 3's `jsx: true` output shape, written by hand, compiled with
  compiler-next: Markdown elements became dynamic component values. The same page as plain
  tags compiled to one template. Not checked: the exact output of a real `@mdx-js/mdx` run (it
  is not installed here), and static-page delivery (the harness did not qualify for it with
  plain tags either).
- `text-template.test.ts`: JSX text reaches the template; `{"text"}` children and `.auwla`
  quoted text are written at run time (slice 0).

## Next

Slice 0 can start now; it needs no decision. Slice 2 waits on the dependency approval.
