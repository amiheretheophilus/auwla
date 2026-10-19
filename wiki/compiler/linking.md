# Linking: several modules

**Folder:** `link/` _(planned)_.

## What it does

Compiles a module graph together, so a component, state or source imported from
another file behaves as if it were local.

## Rules

- One `yuku-analyzer` `Analyzer` holds every file of the build.
  `binding.definition()` and `module.resolveExport()` follow imports and re-exports;
  the resolver option maps Vite aliases.
- Each module gets a **summary**: its exported components, state, sources and
  helpers, and the graph facts other modules need. A module reads other modules
  only through summaries.
- **Module state** (a top-level binding that is written) is state shared by every
  component that reads it. The same classification rules apply
  (`state-and-derived.md`).
- When a file changes, only that file and its dependents are compiled again
  (`module.dependents`).

## Not designed yet

These are ported from `packages/compiler` once the core works, each with its own
page:

- routes and `$routed`;
- server functions and their client stubs;
- server pages;
- package compilation (`experimentalCompilePackage`).
