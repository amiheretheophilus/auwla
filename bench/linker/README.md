# Cross-Module Linker Benchmark

This measures compiler throughput, not application runtime.

Run:

```bash
bun run bench:linker
```

The generated graph contains one state module and one importing TSX view per pair. Every
state module exports a scalar, a module computed value and a mutator. Every view imports all
three through a `@` alias. The same graph is compiled whole by the old compiler and by
compiler-next, in alternating order, and the run reports the median of seven.

It fails if compiler-next leaves a module out, or a view does not read its own state module:
a fast compiler that links wrongly proves nothing.

`bench/package-compilation` asks the question next to this one: what a native package costs
the app that uses it.

## One local run, 2026-11-05

Bun on Windows, so only a guide:

| Modules | Source | Old | New | New per module | New/old |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 0.3 KiB | 8.1 ms | 10.8 ms | 5.39 ms | 1.33x |
| 8 | 1.1 KiB | 24.7 ms | 28.2 ms | 3.52 ms | 1.14x |
| 16 | 2.3 KiB | 44.7 ms | 53.7 ms | 3.36 ms | 1.20x |
| 64 | 9.1 KiB | 127.8 ms | 186.7 ms | 2.92 ms | 1.46x |
| 256 | 36.7 KiB | 508.8 ms | 923.4 ms | 3.61 ms | 1.81x |

## Earlier measurements

Before this comparison, the benchmark measured the old compiler against `compile()` given the
same import metadata directly, which isolated its graph discovery and summary linking. That
`compile()` does not exist in compiler-next, whose analysis is one graph with no second
path to compare against. Those results, and the checkpoints they supported, are in git history
up to `2240d1cb`, and none of them made a speedup or regression claim.
