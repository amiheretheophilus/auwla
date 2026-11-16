# Common Ground

A collaboration studio written in Auwla (`.auwla`). Discover fictional Ghanaian creatives, assemble a
crew, and turn a project brief into a shared workspace. The blue/yellow palette, bold typography,
pill navigation and floating cards draw inspiration from
[Talent Connect Ghana](https://talentconnectgh.com/). The identity, illustrations, project concept
and implementation are original.

## Run

From the repository root, after `bun run build`:

```sh
bun run example:common-ground          # dev server with hot updates
bun run example:common-ground:build    # static build in dist/
bun run example:common-ground:preview
```

The app routes from `/`, so it runs on its own server, not under the shared examples server.

## Pages

Every page has its own URL, so links can be shared and Back works:

| URL | Page |
| --- | --- |
| `/` | Discover: search, filter and sort the collaborators, with the crew alongside |
| `/saved` | The same page, showing only saved profiles |
| `/people/:id` | One collaborator's profile, for example `/people/ama` |
| `/studio` | The crew's workspace: launch it, then check off the milestones |
| `/new` | Write a project brief, or borrow a starter one |
| `/how-it-works` | The three steps, and a reset |
| anything else | A not-found page |

Each page is imported only for its route, so it loads as its own chunk, with its own stylesheet,
the first time it is shown.

## Try the full story

1. Search, or filter by discipline. Toggle availability and sort by day rate.
2. Open a profile (`/people/esi`), save someone, and add Ama and Esi to the starter crew. The
   header count, the crew's day rate and its skill coverage update together.
3. Write your own brief at New project, or borrow a starter one.
4. Launch the crew in My studio, then check off the three milestones.
5. Reload: the crew, saved profiles, brief and milestones stay in this browser. Search starts over.
6. How it works → Reset this playground returns to the starter state.

All profiles are fictional; nothing leaves the browser. A crew has up to four people. Booked
collaborators can be saved but not added. Budget and missing skills are guidance, not a block.

## How it is built

| File | What it shows |
| --- | --- |
| `App.auwla` | The routes (`<Discover route="/" />`), a not-found page in the main bundle, and a toast that dismisses itself with `$effect` and a cleanup |
| `theme.auwla` | The design system as one `<style global>` block: tokens, resets, and shared primitives such as `.button`, whose looks are class conditions (`background: var(--card) @.primary:var(--blue)`) |
| `components/Shell.auwla` | Header and footer. `route-to` links, the current page from `route.pathname`, and a file-level style both components share |
| `components/TalentCard.auwla` | Per-card state (the bio opens in place), loops in markup, and class conditions for saved, booked and added |
| `components/CrewPanel.auwla` | Values derived from shared state: coverage, day rate and budget. `navigate` after a launch |
| `components/Hero.auwla` | Floating artwork laid out mobile-first with responsive values (`font-size: 40px @600:50px @1150:58px`) |
| `components/ui.auwla` | `Icon`, sized by props, and `Section`, with a named `action` slot |
| `pages/*.auwla` | One component per route. `Person` reads `route.params.id` |
| `state.ts` | Ordinary module state and the functions that change it. One module-level `$effect` saves the session whenever it changes |
| `data.ts` | Seed profiles, briefs and milestones |

Each component's `<style>` styles its own elements only, so the same class name in two components
never collides. Styles are compiled to static CSS: there is no styling runtime.
