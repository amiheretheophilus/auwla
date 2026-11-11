# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current requested sequence

The user requested these three steps in order: (1) incomplete-code recovery,
(2) bare-handler completion and auto-imports, (3) direct `for...of` inside markup.
This checkpoint completes the first recovery profile. Steps 2 and 3 remain next;
do not treat the sequence as finished.

Ordinary host syntax stays mapped for native TypeScript recovery. Isolated damaged
markup lines can be quarantined from the exact current revision, keeping their
authored errors and unaffected diagnostics/completion. At most three lines are
blanked, with original UTF-16 width/newlines; successful recovery requires a valid
remaining module. Holes have no editable mapping. Structural cases retain the
empty-module fallback. Production normalization/compilation remains strict.

`src/checking/recovery/markup.ts` owns quarantine and mapping exclusion. Shared
host literal locations and the attribute reader now stop before error recovery
misreads later tags. See [recovery](recovery.md) for exact boundaries and native
client completion-default behavior. No cached previous source is substituted.

## Evidence

Baseline: clean `bbee1afc`. JSX+ `bun check`: 207 files, no errors. JSX+ `bun test`:
**172 passed, 0 failed, 1216 assertions**, twelve files. Includes all previous
parse/runtime/CLI/flow/rename checks plus actual task-board quote, attribute-paren
and ordinary-host-paren edits. An unrelated member error/completion remains
available; accepting completion leaves the syntax error visible, and restoring
the source clears it. Unit checks prove copied-span equality and build rejection.

Direct review covers current-source isolation, native host errors, validation
before publishing partial maps, unmapped holes, bounded attempts, fallback and
strict production behavior. No sub-agents. `git diff --check` passes.
Compiler-next/runtime implementation and draft 0.1 revision 3 grammar are unchanged.
Full root, performance, browser layout and IDE activation checks were not run.

## Continue

Next: P3-HANDLER-IMPORT, using real TypeScript helper exports and actual native
completion/import edits on the task board. Then P4-DIRECT-FOR needs its draft,
implementation and real application/ownership checks before claiming support.

Recovery inside quarantined text and multiline structural damage still need
work. Broader replay proofs, lowering maps, production module loading, Vite/HMR,
delivery and debugging maps remain open. Backend configuration stays planned
and nonreactive; isomorphic support is later. See [plan](plan.md),
[tooling](tooling.md) and [rewrite acceptance](../wiki/status.md).
