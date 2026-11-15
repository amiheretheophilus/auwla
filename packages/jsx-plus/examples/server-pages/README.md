# Server pages

A small project tracker whose panels are rendered on the server. A server function returns
markup with `page(<ProjectBoard project={project} />)`; the server renders it, and the browser
gets HTML, plus the component only when the page can change by itself. Everything is `.auwla`,
styled with its built-in CSS.

```text
bun run examples/server-pages/preview.ts
```

Open `http://127.0.0.1:3038` (`AUWLA_EXAMPLE_PORT` picks another port). `--build` builds, writes
`.memoized/server-functions.d.ts` for the editor, reports the bundle's size and exits. Then check
the types with:

```text
bun ../../node_modules/typescript/lib/tsc.js --project examples/server-pages/tsconfig.json --runExternalCode --pretty false
```

## Layout

| File | What it is |
| --- | --- |
| [server/functions/projects.auwla](server/functions/projects.auwla) | Server functions. `getBoard` and `getFacts` return pages; `createTask` and `completeTask` change a project and invalidate its pages (`updates`) |
| [server/store.auwla](server/store.auwla) | The in-memory projects: server-only code, compiled as written, never in the browser |
| [server/define.ts](server/define.ts) | `createDefine()`, and the re-export of `page` the functions import |
| [src/model.ts](src/model.ts) | The `Project` and `Task` types the store and the pages share |
| [src/App.auwla](src/App.auwla) | The shell: project list, view switch, the add form, and the page itself, shown like any value |
| [src/pages/ProjectBoard.auwla](src/pages/ProjectBoard.auwla) | The interactive page: filters and notes are local state; a task's button calls the server |
| [src/pages/ProjectFacts.auwla](src/pages/ProjectFacts.auwla) | The passive page: no handlers, so the browser gets its HTML and styles, none of its code |
| [src/styles/shared.auwla](src/styles/shared.auwla) | Named styles (`panel`, `pill`) that the shell and the pages `@use` |
| [server.ts](server.ts), [src/main.ts](src/main.ts) | The server's entry (`serve`, `app.ssr(App)`) and the browser's (`mount`) |

## What to try

- **Local state survives the server.** On the board, choose "open", then complete a task. The
  server changes it, the live board arrives again, and the bound component takes the new project
  in place: the filter stays "open". Open a second tab to watch it update there too.
- **Only what a page reads crosses.** In the network panel, `getBoard`'s response carries the
  board's inputs: names, task ids, titles and states. The store's `owner.email` and `budget` are
  not there, since the board never reads them.
- **A page that cannot change ships no code.** Switch to "Facts": the budget appears as rendered
  HTML, and `main.js` contains nothing of `ProjectFacts`.
- **A page brings its own styles.** Each page's `<style>` blocks travel with its HTML, so the facts
  page is styled though its component never reaches the browser.

## The CSS

- `<style global>` in `App.auwla` holds the design tokens (`light-dark()` colours) and the base.
- A file-level `<style>` (the shell, the server function module) selects only the markup written
  in that file; a `<style>` inside a component (each page) selects only that component's.
- `<style id="panel">` in `shared.auwla` is a named block, applied where `@use("…", "panel")` puts
  it, in the scope of the style that uses it.
- Class conditions: `background: transparent @.active:var(--accent)` sets the value while the
  element has the `active` class; the buttons only switch classes.
- Responsive values and groups: `padding: 16px @700:24px`, and `@900 { grid-template-columns: … }`
  inside a rule, become `min-width` media queries.
- Native nesting: `header { h2 { … } }`, `&:hover { … }`.

How it works: [wiki/compiler/server.md](../../../../wiki/compiler/server.md), "Server pages".
