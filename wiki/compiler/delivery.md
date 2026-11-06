# Delivery: as little JavaScript as possible

A page that cannot change ships as plain HTML, with no JavaScript at all, as if it had been
written by hand. This holds for a client-only build as well as a server, and it is a headline
property of the framework. The old compiler does this ("not perfect but it was cool"). The user
wants compiler-next to improve on it, not match it.

Status: a page that cannot change is built. The rest is designed. Phase 10 (`plan.md`).

## Files

| File | What it does |
| --- | --- |
| `features/delivery/index.ts` | `planInitialRender`: finds the application root, runs it, and decides what the page ships |
| `features/delivery/run.ts` | runs compiled modules at build time, in a closed world, on the server's document |
| `features/delivery/html-shape.ts` | whether an HTML parser rebuilds exactly the tree the HTML came from |
| `core/parse/module-function.ts` | a printed ES module as a function body, so the build can run it synchronously |

## What the old compiler does

`packages/compiler/src/dom/render-plan.ts` evaluates the page symbolically at compile time, and
never runs authored code. `packages/vite/src/initial-html.ts` then writes the result into
`index.html`, and removes the script when nothing needs it. Each page gets one tier:

| Tier | Meaning | Browser gets |
| --- | --- | --- |
| `html` | Nothing can change | No script |
| `mixed` | A static shell around interactive components | Those components |
| `bindings` | Known content, with live parts | A program that adopts the existing nodes |
| `request` | Known only per request | Nothing, the server renders it |
| `browser` | Anything it could not prove | The whole page, created in the browser |

### Measured baseline

Production Vite builds of the old compiler (`bun run bench:size:html`), on 2026-11-06. On Windows
it needs `TMP` set to a long path, because a short `THEOPH~1` temp path makes its second build fail
to resolve `react/jsx-runtime`.

| Fixture | HTML | JS | JS gzip |
| --- | --- | --- | --- |
| `static`, `static-name`, `static-list` (40 rows), `static-composition` (40 cards) | 120–2,046 | **0** | **0** |
| `mixed-1-cards` | 265 | 8,975 | 3,626 |
| `mixed-60-cards` | 3,501 | 8,976 | 3,629 |
| `bindings-1-cards` | 275 | 8,848 | 3,585 |
| `bindings-60-cards` | 3,511 | 8,850 | 3,585 |
| `composition-static-children-60` | 4,411 | 8,848 | 3,584 |
| `conditions-60-cards` | 3,621 | 13,265 | 5,075 |
| `empty-todo-60-cards` | 3,589 | 17,454 | 6,565 |
| `future-composition-60-cards` | 3,731 | 14,832 | 5,571 |
| `list-keyed-60-cards` | 3,644 | 25,270 | 9,130 |

What works: static content costs nothing, since 60 cards ship the same JS as one.

### Where it falls short

1. **Any call or statement in a component gives up, for the whole page.** Each of these is static,
   and each ships the full page as `browser`:

   | Program | Why it gave up |
   | --- | --- |
   | `function up(x) { return x + '!'; }` used in JSX | Calls need browser execution |
   | `'abc'.toUpperCase()`, `['a', 'b'].join(',')` | Calls need browser execution |
   | `[1, 2, 3].filter(…)`, then `.map(…)` in JSX | Calls need browser execution |
   | `Math.max(1, 2)`, `JSON.stringify(…)`, `Object.keys(…)` | Calls need browser execution |
   | `for (…) rows.push(i)` | Component setup needs browser execution |
   | `if (on) return <p />;`, `switch` | Component setup needs browser execution |
   | `style={{ color: 'red' }}` | Object coercion needs browser execution |
   | `class C { … }` at module level | Module initialization needs browser execution |
   | An import from a package, even one card's | External import may have browser effects |

2. **A counter costs 8.8 kB.** That is mostly the runtime, not the page's code. A page with one
   button pays for far more than it uses.

3. **It reimplements JavaScript.** The symbolic evaluator is 1,095 lines, and every builtin it does
   not model is a page that ships in full.

## Design

### Run the program, rather than model it

Instead of a symbolic evaluator, compiler-next runs the program at build time, in a closed world,
and reads what it renders. It runs the **compiled** program, the same one the browser would run, on
the server's string document (`packages/server/src/string-document.ts`). So there is no second
implementation of lists, slots or attributes that could differ from the browser's, and a static page
and server rendering are one path.

1. **Close the world.** A compiled module sees only the runtime, other compiled modules and the
   globals it is given. A name that is not allowed is passed in as a value that stops the run when
   anything touches it, so only code that really runs at first render counts: `alert` in a click
   handler is no obstacle, and `alert` in a component's body is.
   - Allowed: `Math` without `random`, `JSON`, `Object`, `Array`, `String`, `Number`, `Boolean`,
     `Map`, `Set`, `Symbol`, `RegExp`, the error types, `parseInt`, `parseFloat`, `isNaN`, `isFinite`
     and the URI functions.
   - Not allowed: `Date`, `Math.random` and the `toLocale*` methods, whose results depend on the clock
     and the machine; `fetch`, `window`, `document`, `console` and any other global; and any import
     from outside the compiled modules, which can do anything when it loads.
2. **Run it.** A pure helper, `.filter().map()`, a `for` loop and an `if` simply work, with
   JavaScript's exact semantics, and there is no list of builtins to keep up to date.
3. **Decide.** The page is `html` only if nothing can happen after it is shown: no listener, effect
   or ref was installed, and no async function exists. A failed run of any kind leaves the page to
   the browser, which shows any error itself.
4. **Check the shape.** The HTML parser must rebuild exactly the tree it came from (`html-shape.ts`).
   Where the old compiler refuses every `table`, `select`, `pre` and `svg`, this checks what each
   one contains, so a well-formed table stays static.

The closed world is there for determinism. It is not a security boundary: a project's own code
already runs during its build, through its Vite config and plugins.

**This reverses a rule of the old compiler:** "planning never executes an authored function". The
reason to reverse it is point 3 above. It is recorded as a decision for the user in
`../open-issues.md`.

### Decide per region, not per page

A failure stops at the nearest component boundary. If one card calls a package, that card is a hole
in the HTML and only it is created in the browser, while the rest of the page stays static. The old
compiler's first failure sent the whole page to `browser`.

### What each part of a page costs

| Part | Browser gets |
| --- | --- |
| Nothing in it can change | Nothing. The component's code is not shipped at all |
| It has live parts, and its content is known | Update code that adopts the existing nodes, with no creation code |
| It can be created again later, such as a branch or a row | Creation code for that part only |
| It could not be run at build time | Everything, for that part only |

compiler-next already has these facts, per binding and per site (`plan.md`, phases 3 to 9), which is
why this can go further than the old compiler's whole-page answer.

### Adopting existing nodes

The compiled program already finds its nodes by walking from a template's root
(`firstChild`, `nextSibling`). Adopting is the same walk, starting at the existing root instead of
a clone. HTML cannot hold an empty text node, so an empty slot needs a marker, as in the old
`<!--mmd:empty-->`.

### How it is tested

The comparison cases are the proof. Each case in `tests/cases` gains a third compiler mode beside
optimized and general: `delivered`, which starts from the build-time HTML and adopts it. Every step
must match the reference, so all existing programs check delivery without new cases. Shipped JS per
fixture is compared with the table above by `bench:size:html` with `BENCH_COMPILER=next`.

## Order of work

1. Closed-world proof, the build-time run, and HTML for pages that cannot change. The zero-JS case.
2. Adoption in the runtime, and the `delivered` comparison mode.
3. The per-region decision, and leaving out code for parts that cannot change.
4. A smaller runtime for a page that only binds.
5. Server rendering and hydration on the same path, and the Vite side.
