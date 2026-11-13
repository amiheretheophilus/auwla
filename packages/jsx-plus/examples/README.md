# Authoring examples

Run commands below from `packages/jsx-plus` using the installed workspace dependencies.

The example configs enable `@memoized-dom/jsx-plus/types` once through
`compilerOptions.types`, reusing the existing element/event/ref declarations.
The counter has no per-file JSX type import. `examples/tsconfig.json` includes
top-level `.auwla` files, so new modules there receive the same types. Configured
projects use `jsx: "preserve"`; TypeScript checks a TSX view without selecting a
React JSX runtime. Other projects need this one-time configuration too.

| Example | What to read and try |
| --- | --- |
| [counter.auwla](counter.auwla) | The smallest state/event/direct-expression example |
| [greeting.auwla](greeting.auwla) | Editable greeting, conditional branches, native event input and looped names; real completion and runtime checks use this file |
| [task-board/App.auwla](task-board/App.auwla) | A complete task board: derived lists/counts, search, status filters, form submission, existing refs, direct `if`, direct `for` loops in the markup, quoted text and row events |
| [team/](team/) | Routes (nested, parameters, catch-all), lazy route chunks, `Group` pending/error policies, `<slot>` layouts, `$fetch`/`$track` with a reactive helper, `$routed`, `$effect` and `$cleanup` |
| [notes/](notes/) | Several `.auwla` components importing each other (with and without the extension, through a `.ts` re-export), built by compiler-next's project, Bun plugin and Vite plugin |
| [checking/App.auwla](checking/App.auwla) | Small typed-prop/ref example used by the mapper checks |
| [checking/TypeError.auwla](checking/TypeError.auwla) | Deliberately invalid method call for inspecting authored diagnostics |

For member completion, open `greeting.auwla` and temporarily change
`if (name.length > 0)` to `if (name.)`. Completion at the dot should offer
string members such as `length`. Try `model.` in the loop iterable or `row.`
inside its body too. An unfinished expression still has a native syntax error;
the checking view keeps it mapped so that completing it can clear that error.
The real-server tests apply these edits and recheck the completed file. Keep the
saved example valid when running the whole package suite.

## Run the task board

```text
bun run examples/task-board/preview.ts
```

Open `http://127.0.0.1:3030`. Use `AUWLA_EXAMPLE_PORT` to choose another port.
Stop the process with Ctrl+C. The example builds once on startup; restart it after
editing source. It serves the application, CSS and HTML locally, with no persistence.

For a build-only check:

```text
bun run examples/task-board/preview.ts --build
```

For authored TypeScript checking, including its entrypoint:

```text
bun ../../node_modules/typescript/lib/tsc.js --project examples/task-board/tsconfig.json --runExternalCode --pretty false
```

The preview ([preview.ts](preview.ts)) builds with compiler-next's own Bun plugin,
passing `auwla` as a source language, and bundles the current checkout's browser
runtime. It compiles nothing itself. The same option works with the Vite plugin.

## Run the notes app (several `.auwla` files)

```text
bun run examples/notes/preview.ts
```

Open `http://127.0.0.1:3031`. [notes/App.auwla](notes/App.auwla) imports
`./NoteForm.auwla` by its full name and `NoteList` through
[notes/components/index.ts](notes/components/index.ts), a plain TypeScript
re-export of `./NoteList` with no extension. The form reports through an `onAdd`
prop; the list removes through `onRemove`, with a direct `if` for the empty state
and a direct `for` for the rows. [notes/notes.ts](notes/notes.ts) is a TypeScript
helper with module state. Its `index.html` loads `/main.ts`, so the folder also
runs under Vite with `memoizedDom({ clientEntry: 'main.ts', compiler: 'next', languages: [auwla] })`.
`tests/modules.test.ts` and `tests/vite.test.ts` build and run this folder.

## Run the team directory (routes, lazy pages, data, effects)

```text
bun run examples/team/preview.ts
```

Open `http://127.0.0.1:3032`. The preview answers the pages' requests from a small
in-memory API and serves deep links such as `/people/2`. Everything is written in
`.auwla`; compiler-next does the work:

- [team/App.auwla](team/App.auwla) declares the routes: `route="/"`, a `/people`
  section whose heading stays while its child routes `/` and `/:id` swap, `/about`,
  and a catch-all `/*`. Links use `route-to`, including the parameter form
  `route-to={{ path: '/people/:id', params: { id } }}`.
- The three pages are imported only for their routes, so each loads as its own
  chunk when its route is first shown. `NotFound` is declared in `App.auwla` and
  stays in the main bundle.
- `<Group pending=PageLoading>` in `App.auwla` wraps every page: wherever a page
  reads data that has not arrived, `PageLoading` shows in its place, with no
  wrapper element.
- [team/components/Card.auwla](team/components/Card.auwla) is a layout with
  `<slot name="header">` (falling back to `"Team"`), a default `<slot />` and
  `<slot name="actions" />`. Pages fill them with `slot="header"`/`slot="actions"`
  children; `<slot>` is compiler syntax and never reaches the DOM. The not-found
  page passes no header, so the fallback shows.
- [team/pages/People.auwla](team/pages/People.auwla) loads people through
  [team/api.ts](team/api.ts), a helper returning `$fetch`. Typing in the search
  box changes its argument, so the same binding requests again while the old list
  stays. An error-only `<Group error=Failure>` keeps the app's pending policy and
  shows a `Failure` component whose `retry` asks again; `$track(people).refreshing`
  shows "Updating…" during a search.
- [team/pages/Person.auwla](team/pages/Person.auwla) loads its person with
  `$routed`, so the list stays until the person arrives, and an `$effect` sets
  `document.title`; its cleanup puts the old title back.
- [team/pages/About.auwla](team/pages/About.auwla) runs setup once per visit and
  a `$cleanup` when the route leaves. Both pages record into
  [team/lifecycle.ts](team/lifecycle.ts).

A text child followed by a tag needs `;` (`"Could not load people. "; <button>`):
without it, `"…" <button>` reads as a comparison (spec grammar rule 5).
`tests/routes.test.ts` bundles this folder with chunk splitting and drives it in
both compiler modes; `tests/vite.test.ts` checks Vite splits the same pages.

## Walk through the authoring

Start with the types and ordinary local variables in `App.auwla`. `remaining` and
`visible` derive from the tasks, search query and selected filter. The event
functions change those values with normal JavaScript. `draft` is a normally
declared ref connected through `ref=(draft)`; submission reads, clears and focuses
the actual input.

Attribute values accept `name={expression}` and `name=(expression)`. The main
example uses `aria-label=("Remove " + task.title)` and `ref=(draft)`. Events
still receive ordinary values: `onClick=(handler)` passes a function, while
`onClick=(() => removeTask(id))` supplies an explicit callback. Calls are not
made lazy automatically. Existing JSX braces remain available.

A single identifier also works without delimiters: the form uses
`onSubmit=addTask`. It becomes an ordinary JSX function reference, so the handler
receives the native event. The bare
name can also be imported: `onClick=focusTaskInput` uses a normal exported
function from [task-board/actions.ts](task-board/actions.ts). Bare calls such
as `onClick=addTask()` need explicit parentheses/braces and are not made lazy.

Then read the markup: quoted children produce text, expressions render values,
and direct `if` switches between the empty message and the list. Two direct
loops write repeated markup in place. `for (const option of filters) { <button ...> }`
makes the status buttons from an ordinary array, each with its own `option` for
its handler. Inside the `else` branch, `for (const task of visible) { <li key={task.id}> ... }`
writes each row with its toggle/remove handlers. A loop accepts any iterable
and becomes `Array.from(visible, (task) => <li ...>)`; see
[direct loops](../../../wiki2/syntax.md#direct-loops). Both loops become
compiled keyed row lists when optimizing (`_rowList.from(...)` in the served
bundle), so a row keeps its DOM node while it stays visible. The page has
real labels, keyboard-native buttons and live summary text. The footer uses a native backtick template with
`${...}` interpolation. Spec revision 7 also supports quoted child text such as
`"Count: {count}"`; the counter demonstrates it without a per-file type import.
Use `\{` for a literal opening brace. Substitutions follow native template-string
coercion and reactivity; strings inside calls and attributes keep their own rules.
The real LSP checks complete, hover and rename inside these quotes, including
completion in empty or unfinished substitutions.
CSS and `main.ts` stay ordinary files.

The package checks load this file directly, rather than maintain a second version
inside a fixture. They cover search/filter changes, the looped buttons'
`aria-pressed` state, row node preservation, add/toggle/remove, ref focus and the
empty state in both compiler modes. The mapper cache checks also transform
this same authored source. Browser layout and production delivery need their own
acceptance; these checks establish the exercised authoring and runtime behavior.
A real LSP rename of the row loop's `task` binding edits only uses inside that
loop. Native completion checks apply an actual insert/replace edit to a partially typed
member in the main app's parenthesized row label.
