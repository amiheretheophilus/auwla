# compiler-next

The rewrite of the Memoized DOM compiler. It takes ordinary TypeScript and JSX and emits plain
JavaScript that updates exactly what changed, with no virtual DOM. It takes the old compiler's
place at the end of Phase 10 (`../../wiki/compiler/plan.md`).

The design, one page per group of related files, is in `../../wiki/compiler/`. Start with its
`README.md`. The ground rules every change must meet are in `../../wiki/rules.md`.

## Using it

```ts
import { compileModules } from './src';

const output = compileModules({
  './App.tsx': `
    export function App() {
      let count = 0;
      return <button onClick={() => count++}>{count}</button>;
    }
  `,
}, { entries: ['./App.tsx'] });
```

`compileModules` takes every module of the graph by path and returns JavaScript by path.

| Option | What it does |
| --- | --- |
| `entries` | Which modules code outside the graph can use. The source proof then follows the real calls of every other export. Leave it out to assume every export is open. |
| `resolveImport` | Maps a specifier to a path in the graph. A build tool gives it, so bare specifiers and aliases reach native packages. |
| `optimize` | `false` keeps only the general mode. It must behave the same as the optimized one. |
| `runtimePath` | Where generated code imports the runtime from. |

## What the output does

- **State is plain variables.** `let count` stays a `let`. Each component has one `_update` that
  sets each spot that can change, guarded by version counters.
- **Derived values follow what they read.** `const total = price * qty` re-runs when either
  changes. A later assignment takes the value over.
- **Lists and mutations are observed.** `items.push(x)` and `user.address.city = 'x'` update what
  read them, through whichever alias they were made.

## Readiness

A value that loads over time (`$fetch`, `$read`, a server function) makes everything computed from
it wait. Nothing has to be marked:

```tsx
export function App() {
  const user = $fetch('/me');
  const title = user.name.toUpperCase();
  return <Group pending={() => <i>loading</i>}><p>{title}</p></Group>;
}
```

- `title` waits for `user`, and `<p>` waits for `title`. A statement that reads a loading source does
  not run until it is ready, and neither does what it builds.
- `Group` chooses what shows while its contents wait, or fail. Without one, the spot stays empty.
- Only the branch that runs is waited on: `flag ? user.name : 'guest'` does not wait while `flag`
  is false.
- `$track(source)` reads the status (`pending`, `error`) without waiting for the payload.
- The proof of which values can hold a source is whole-graph (`src/features/sources/reach.ts`), so
  code that cannot touch one carries no readiness code at all.

The rules are in `../../wiki/compiler/sources.md`.

## Packages

A native package ships its source and compiles in the app's graph, which is how state, derived
values and readiness cross its boundary. An ordinary npm package runs as it is, and what it reads is
opaque. See `../../docs/library-packaging.md` and `../../wiki/compiler/linking.md`.

## Testing

Every behaviour is a case: a program and what a user does to it, compared after each step against a
reference renderer that re-renders everything, in optimized and general modes. See
`../../wiki/compiler/testing.md`.

```sh
bun check                                   # types
bun test src                                # unit tests
COMPILER=next bun test tests/cases/<file>   # the cases a change affects
```
