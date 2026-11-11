# Authoring examples

Run commands below from `packages/jsx-plus` using the installed workspace dependencies.

| Example | What to read and try |
| --- | --- |
| [counter.auwla](counter.auwla) | The smallest state/event/direct-expression example |
| [task-board/App.auwla](task-board/App.auwla) | A complete task board: derived lists/counts, search, status filters, form submission, existing refs, direct `if`, `.map()`, quoted text and row events |
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
declared ref connected through `ref={draft}`; submission reads, clears and focuses
the actual input.

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
