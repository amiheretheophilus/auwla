# Authoring examples

Run commands below from `packages/jsx-plus` using the installed workspace dependencies.

| Example | What to read and try |
| --- | --- |
| [counter.auwla](counter.auwla) | The smallest state/event/direct-expression example |
| [task-board/App.auwla](task-board/App.auwla) | A complete task board: derived lists/counts, search, status filters, form submission, existing refs, direct `if`, `.map()`, quoted text and row events |
| [task-board/ForLoop.auwla](task-board/ForLoop.auwla) | Ordinary `for...of` builds row markup before the UI; independent row callbacks, filtering and add/remove |
| [checking/App.auwla](checking/App.auwla) | Small typed-prop/ref example used by the mapper checks |
| [checking/TypeError.auwla](checking/TypeError.auwla) | Deliberately invalid method call for inspecting authored diagnostics |

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

For the ordinary loop variant:

```text
bun run examples/task-board/preview.ts --for-loop
bun run examples/task-board/preview.ts --for-loop --build
```

`ForLoop.auwla` uses `for (const task of visible)` outside markup, pushes each
row into `rows`, then renders `<ul>rows</ul>`. This is existing host JavaScript;
direct `for` statements inside markup are still planned.

For authored TypeScript checking, including its entrypoint:

```text
bun ../../node_modules/typescript/lib/tsc.js --project examples/task-board/tsconfig.json --runExternalCode --pretty false
```

The preview's small Bun loader normalizes `.auwla` and calls compiler-next, then
bundles the current checkout's browser runtime. It demonstrates this single UI
module; production Vite loading, HMR and general multi-module support remain planned.

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

A single identifier also works without delimiters: the loop app uses
`onClick=addTask`, and the main form uses `onSubmit=addTask`. They become ordinary
JSX function references, so the handler receives the native event. The bare
name can also be imported: `onClick=focusTaskInput` uses a normal exported
function from [task-board/actions.ts](task-board/actions.ts). Bare calls such
as `onClick=addTask()` need explicit parentheses/braces and are not made lazy.

Then read the markup: quoted children produce text, expressions render values,
and direct `if` switches between the empty message and the list. `.map()` authors
each row with its toggle/remove handlers. The page has real labels, keyboard-native
buttons and live summary text. The footer uses a native backtick template with
`${...}` interpolation; double-quoted children are ordinary static strings.
CSS and `main.ts` stay ordinary files.

The package checks load this file directly, rather than maintain a second version
inside a fixture. They cover search/filter changes, add/toggle/remove, ref focus
and the empty state in both compiler modes. The mapper cache checks also transform
this same authored source. Browser layout and production delivery need their own
acceptance; these checks establish the exercised authoring and runtime behavior.
The loop variant is also compiled and exercised directly from its authored file.
Native completion checks apply an actual insert/replace edit to a partially typed
member in the main app's parenthesized row label.
