# Mapper transform reuse

State: bounded project-local cache built, 2026-11-11. TOOL-06 has deterministic
reuse evidence; latency and memory acceptance remain open.

## Contract

`packages/jsx-plus/src/mapper/project.ts` owns one latest transform per open
mapper project. A hit requires the exact filename and exact full source text.
It retains the complete checking result together: TSX, authored diagnostics,
supplemental views, span maps and diagnostic directives. It keeps no parser AST,
analysis snapshot, earlier revision or second file entry.

An edit or filename switch recomputes and replaces the entry. Undo recomputes
after an intervening different input. Equivalent-but-differently-spelled paths
miss safely; there is no path canonicalization or source hash collision policy.
Authored syntax-error results can be reused for identical input, but the next
edit computes its own result. Unexpected projection exceptions are not cached.

`src/mapper/server.ts` owns independent `CheckingProject` instances by handle.
Every `openProject`, including reopening the same handle with new configuration,
creates a fresh instance. `closeProject` removes it; transport close drops all
instances. Configuration is fixed for that open lifetime. No accepted mapper
options or dynamically read configuration files exist yet; unknown options still
produce their existing diagnostics. Future output-affecting inputs must become
part of invalidation before they are introduced.

The cached object is internal and treated as read-only. JSON-RPC serialization
gives clients their own response data. No cache counters or debug requests are
added to the TypeScript mapper protocol.

## Evidence from real authoring

`tests/mapper-cache.test.ts` wraps the real `projectForChecking()` with a call
counter. It transforms [the task-board source](../packages/jsx-plus/examples/task-board/App.auwla),
including its actual supplemental checking view. Seven requests perform five
projections: the two exact repeated inputs hit; an edit, undo and filename
switches recompute. Restored results match the original content without retaining
the original object.

Other cases exercise repeated parse diagnostics, restoration to the real example,
and separate project instances. The framed transport test additionally checks
close/reopen and handle isolation. Actual CLI/LSP edit and rename checks continue
to exercise the cached mapper server.

This establishes reuse counts and the one-entry bound, not measured heap usage,
editor latency or incremental parsing. [Tooling](tooling.md) owns broader editor
acceptance. [Checking flow](checking-flow.md) owns the projection's semantic limits.
