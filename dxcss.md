# Auwla CSS developer experience: styling design discussion

Status: design discussion and proposed implementation plan. **The style-block
compiler, utility aliases, conditions and CSS editor service described here are
not implemented.** Existing ordinary CSS imports and configured Tailwind classes
remain the starting point.

Created: 2026-11-11. Updated: 2026-11-11.

This is the styling companion to [dx.md](dx.md), especially its class/style and
file-scoped CSS proposals. [wiki2](wiki2/README.md) maps the prototype and
[the language spec](wiki2/spec/README.md) owns implemented syntax contracts.
This document does not revise that spec or claim a new conformance level.

The purpose is to describe a useful authoring experience in enough detail to
challenge it, prototype it and revise it in small slices. User requests,
recommendations and unresolved choices are distinguished below.

## 1. What we want to improve

Writing Tailwind classes already works when a project has Tailwind configured:

```tsx
<button class="rounded-lg bg-blue-600 px-4 py-2 text-white">
  "Save"
</button>
```

That is existing compatibility, not the proposed abstraction. The opportunity is
to make related styling easier to read, reuse and edit while preserving ordinary
CSS and the project's existing design tokens.

The proposed experience combines:

- Local styles in a top-level `<style>` block beside the component code.
- Ordinary CSS declarations, selectors, nesting and at-rules.
- Utility shorthands such as `p:4`, with optional Tailwind integration.
- Compact conditional values: `p:4 @md:6 @lg:8`.
- The same conditional syntax on ordinary CSS properties:
  `padding:4px @md: 30px`, with values interpreted as CSS rather than utility tokens.
- Grouped conditions when several properties change together.
- Completion, highlighting, hover and diagnostics that understand the same rules
  as the compiler.

Styling extends the separate JSX+ authoring package and continues to use
compiler-next for the component program. It introduces no new reactive state,
ref API or independent component compiler. Existing naming remains in place
until the planned project-wide rename.

## 2. Discussion record and decision status

| Topic | Direction discussed | Status |
| --- | --- | --- |
| Detailed styling document | User requested an MD beside `dx.md` | Requested; this document |
| Utility spelling | User suggested `p:4` rather than `p-4` inside styles | User-proposed candidate |
| Compact conditions | User clarified `p:4 @md:6 @lg:8`; quotation marks were message-entry workarounds | Preserve this exact candidate spelling |
| Conditions on ordinary CSS | User: "i can have padding:4px @md: 30px and it will work or has to work" | Required design direction; applies to ordinary properties as well as aliases |
| Grouped conditions | Offer blocks for several related changes | Discussed candidate |
| Ordinary CSS | Mix normal declarations with the shorthand | Discussed direction; exact grammar still needs fixtures |
| Semicolons | Optional after shorthand entries; newline separates entries | Recommendation; lexical rules below are provisional |
| Local scope by default | `<style>` is local; `<style global>` is explicit | Recommendation, not yet an implemented or accepted spec rule |
| Tailwind | Optional integration for utilities and theme values | Recommendation; API/version probe required |
| CSS tooling | Completion and highlighting are part of a usable feature | User requested capability; implementation planned |
| Other conditions | Hover, focus, disabled and dark mode | Later candidates with different semantics to specify |

There is no quoted-condition syntax. Write `p:4 @md:6`, not
`p:4 "@md:6"`. Do not introduce `$` variables or implicit JavaScript identifiers
through the styling design.

## 3. A complete authoring example

The following is a design target, not an example accepted by today's parser:

```tsx
<style>
  .task-board {
    p:4 @md:6 @lg:8
    bg:white
    rounded:lg

    display: grid;
    gap: 1rem;
    max-width: 80rem;
    margin-inline: auto;

    @md {
      grid-template-columns: 16rem 1fr;
    }
  }

  .add-button {
    px:4
    py:2
    bg:blue-600 @hover:blue-700 @active:blue-800

    color: white;
    border: 0;

    &:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 3px;
    }
  }
</style>

export function TaskBoard() {
  let count = 0;

  function addTask() {
    count++;
  }

  return (
    <section class="task-board">
      <p>"Tasks added: {count}"</p>
      <button type="button" class="add-button" onClick=addTask>
        "Add task"
      </button>
    </section>
  );
}
```

The JavaScript, handler and quoted interpolation keep their existing meanings.
The new work is extracting and interpreting the module's styles, producing CSS
and associating its local selectors with the appropriate authored elements.

## 4. Where style blocks belong

Proposed first boundary: recognize style blocks only at module top level.
Imports, exports and ordinary declarations can appear around them. Several
blocks, if allowed, retain authored order and share the same file scope.

```tsx
<style>
  .card { padding: 1rem; }
</style>

export function Card() {
  return <article class="card">"Hello"</article>;
}
```

A `<style>` returned inside a component remains an ordinary markup element.
Special module syntax must not silently capture every element with that name.
The parser must also leave strings, comments and unrelated JavaScript containing
`<style>` alone. Define how an apparent `</style>` inside a CSS comment or string
is handled before choosing the block scanner; substring replacement is inadequate.

Initial recommendation: static style blocks. They do not implicitly capture
component locals or evaluate expressions. Dynamic styling continues through the
existing inline-style facilities, including CSS custom properties where supported.
Possible future CSS interpolation needs a separate typing, ownership and SSR
contract. Quoted markup interpolation does not automatically apply inside CSS.

Configured backend `.auwla` files retain ordinary backend execution. Whether a
backend entry can import a styled UI module is a module-loading/isomorphic design
question; merely supporting this file extension must not load browser styles.

## 5. Local styling and global styling

Recommended authoring default:

```tsx
<style>
  .card { padding: 1rem; }
</style>

<style global>
  body { margin: 0; }
</style>
```

Under this proposal, `scoped` is unnecessary on the common local block. The
implementation still performs scoping. `global` changes selector ownership, not
whether the style block uses normal CSS or optional utility syntax.

Proposed scope boundaries to test:

- A local block belongs to the source module and covers DOM authored by every
  component in that module. It is not a fresh scope per mounted instance.
- Imported child components retain their own authored-element scope. A parent
  does not automatically stamp its scope onto child internals or forward it
  through a component prop spread.
- Two components in the same file intentionally share local class names. If
  independent component scope is later needed, give it an explicit design.
- Portalled DOM authored in the module should retain its scope association;
  selector matching still follows its actual DOM position.
- Global styles, inheritance, custom properties and the normal cascade can
  cross component boundaries. Local selector rewriting is not Shadow DOM.

For illustration only, a selector could become
`.card:where([data-mmd-scope="s1"])`, with a matching marker on authored DOM.
Using `:where(...)` for a generated marker is a candidate for avoiding additional
specificity; the exact selector transformation is unresolved.

Before implementation, cover descendant/sibling selectors, selector lists,
`:is()`, `:not()`, `:has()`, pseudo-elements, nested rules and foreign DOM.
Rewriting only the start of each selector is insufficient. Decide an explicit
global/deep escape rather than letting local rules accidentally penetrate child
internals. Global at-rules such as `@font-face` and local keyframes also need
separate rules; a scope attribute alone does not isolate their names.

## 6. Utility aliases and ordinary CSS

Candidate aliases map explicitly to utility candidates:

| Authored entry | Utility candidate | Intended category |
| --- | --- | --- |
| `p:4` | `p-4` | Padding on all sides |
| `px:6` | `px-6` | Horizontal padding |
| `py:2` | `py-2` | Vertical padding |
| `m:4` | `m-4` | Margin |
| `w:full` | `w-full` | Width |
| `h:12` | `h-12` | Height |
| `bg:blue-600` | `bg-blue-600` | Background utility |
| `rounded:lg` | `rounded-lg` | Border-radius utility |

This is an initial discussion list, not a complete utility grammar. For example,
`bg` covers several Tailwind utility families; completion must consult the
provider instead of assuming every value is a color. Negative values, fractions,
arbitrary values, important utilities and custom utilities need explicit cases.

Ordinary properties retain ordinary CSS meanings:

```css
.card {
  p:4
  bg:blue-600

  padding-inline: 1.25rem;
  gap: 1rem;
  flex: 1;
}
```

Recommended collision rule: aliases occupy an explicit reserved table; standard
CSS property names are not repurposed as Tailwind scale names. `gap:4` must not
silently switch between raw CSS and a spacing token based on whether a value
happens to parse. Existing `flex`, `color`, `opacity` and `display` remain CSS.
Custom properties beginning `--` also remain CSS.

Possible aliases that later collide with platform additions require versioned
handling. Unknown normal properties should follow the CSS toolchain's extensible
validation behavior, not a hardcoded list that rejects future browser features.
Unknown reserved-alias values should receive provider-aware diagnostics.

Raw Tailwind class strings are unchanged. Named local rules, utility classes,
inline styles and imported styles continue to participate in the normal cascade.
There is no promise that the last class token wins or that utilities are merged
at runtime. Any conflict-merging helper is a separate feature.

## 7. Newlines, semicolons and lexical boundaries

Proposed extension rule: a top-level newline, semicolon or closing rule brace
ends a utility entry or a declaration's compact condition chain. This applies
to ordinary CSS properties carrying a chain as well as utility aliases.

```css
.card {
  p:4 @md:6 @lg:8
  bg:white @hover:blue-50;
  padding:4px @md: 30px
}
```

All entries are complete. The background declaration does not inherit padding
or its conditions. With semicolons, several entries can occupy one line:

```css
.card { p:4 @md:6; bg:white @hover:blue-50; }
```

First-slice recommendation: require a newline or semicolon between shorthand
entries. Do not also guess boundaries in `p:4 bg:white` on the same line.

Ordinary CSS declarations without a compact chain retain normal declaration
termination. The authoring convention uses semicolons for those declarations;
standard CSS's optional final semicolon before a closing brace remains valid.
Newlines do not generally terminate CSS values, and the extension must preserve
multiline CSS:

```css
.card {
  grid-template-columns:
    minmax(0, 1fr)
    16rem;
}
```

The lexer must track strings, escapes, comments, parentheses and brackets. An
`@` in a quoted string, URL, comment or function argument is not automatically
a condition. A newline inside a balanced value is not an entry boundary.
How CSS comments interact with shorthand line endings belongs in the fixtures.

## 8. Compact conditions

The user's candidate syntax is:

```css
.card {
  p:4 @md:6 @lg:8
  bg:white @md:blue-50
}
```

Each `@condition:value` continues the property or alias on that entry. It supplies a value
under a condition; it is not a string, JavaScript expression or new property.
The base value applies normally and each matching override contributes another
CSS rule subject to the cascade.

Compact conditions are required on ordinary CSS properties as well as aliases:

```css
.card {
  padding:4px @md: 30px
  margin-inline: auto @lg: 2rem
  grid-template-columns: 1fr @md: repeat(2, minmax(0, 1fr));
}
```

Whitespace after the base or override colon is allowed. `padding:4px @md:30px`
and `padding: 4px @md: 30px` have the same meaning. Ordinary properties retain
CSS values: `4px` and `30px` are literal lengths, not Tailwind spacing entries.
An alias such as `p:4 @md:6` instead resolves both values through its utility
provider. Each override inherits the property and its value interpretation.

For example, with `md` configured as `48rem`, this input:

```css
.card {
  padding:4px @md: 30px
}
```

has this conceptual output before selector scoping:

```css
.card {
  padding: 4px;
}

@media (width >= 48rem) {
  .card {
    padding: 30px;
  }
}
```

This ordinary-property form must work without a utility provider once its named
condition is configured. Tailwind is optional for this capability. The parser
must preserve full CSS values, including functions, strings and lists; `@` only
starts an override at a valid top-level extension boundary. Custom properties
also require fixtures because their values can contain arbitrary tokens that
must not be accidentally split as conditions.

Proposed first semantics, using an illustrative theme whose medium breakpoint
is `48rem` and whose spacing unit is `0.25rem`:

```css
.card {
  padding: 1rem;
}

@media (width >= 48rem) {
  .card {
    padding: 1.5rem;
  }
}
```

This explains `p:4 @md:6`; it does not prescribe hardcoded Tailwind values or
the final scoping representation. Actual output follows the project's theme
and utility provider.

Potential later forms include `bg:blue-600 @hover:blue-700` and values under
`@focus-visible`, `@active`, `@disabled` or `@checked`. These are candidates to
validate independently. A hover condition must state whether it matches raw
`:hover` or the utility provider's hover variant, including any media guard.
Dark mode must follow an explicitly selected media/selector configuration.

The initial compact-condition profile includes both ordinary properties and
utility aliases. The user's clarification supersedes the earlier recommendation
to defer ordinary properties. Condition availability is a separate question:
responsive conditions can ship first while state forms such as
`opacity: 1 @disabled:0.5;` await their own condition semantics. Full CSS value
parsing is an implementation requirement, not a reason to restrict the design
to aliases.

## 9. Grouped conditions and responsiveness

Groups collect several declarations under a shared condition:

```css
.card {
  p:4
  display: grid;
  grid-template-columns: 1fr;

  @md {
    p:6
    grid-template-columns: 1fr 1fr;
  }

  @lg {
    p:8
    gap: 2rem;
  }
}
```

The compact and grouped forms should share one condition representation and
produce equivalent rules when their declarations and source order are equivalent.
Grouping does not establish a new component scope or introduce runtime listeners.

Proposed condition vocabulary:

| Form | Intended meaning | Status |
| --- | --- | --- |
| Base declaration | All viewport widths | Proposed initial profile |
| `@md` | Configured medium width and above | Proposed initial profile |
| `@max-md` | Strictly below that same width | Proposed initial profile |
| `@md { @max-lg { ... } }` | Medium-inclusive to large-exclusive range | Candidate composition |
| `@media (width >= 53rem)` | Native CSS condition | Preserve normal CSS |
| `&:hover { ... }` | Native selector state | Preserve normal CSS |
| `@hover { ... }` | Named hover condition | Later candidate |
| `@dark { ... }` | Project-defined dark-mode condition | Later candidate |

Names denote thresholds, not device types: `@sm` must not mean "phones only".
Use one breakpoint source for build and tooling. In a Tailwind-enabled project,
read the configured theme rather than maintaining an unrelated Auwla copy.
Without Tailwind, plain media queries still work; a future named-breakpoint
configuration needs its own documented surface.

Unknown named conditions should produce an authored diagnostic. Native at-rules
such as `@media`, `@supports`, `@container` and `@layer` stay distinct from named
conditions. Define valid placement before accepting module-level `@md` blocks.
Do not accept arbitrary Tailwind variant chains accidentally through punctuation.

Viewport and container size are different inputs. Preserve native container
queries initially. Any later named-container shorthand must specify the queried
container and its setup; it must not reuse `@md` with an implicit change of meaning.

## 10. Cascade, order and condition overlap

Recommended default: preserve authored declaration/rule order through expansion.
Do not silently sort breakpoint overrides or group distant rules if that changes
their cascade behavior. Provider-required layers and priorities must be explicit.

```css
.card {
  p:4
  padding: 2rem;
}
```

If both expansions produce declarations at the same cascade priority, the later
padding declaration wins. A shorthand can expand into several properties, so the
full declaration sequence matters; do not merge it using string replacement.

```css
.button {
  bg:blue-600 @hover:blue-700 @disabled:gray-300
}
```

This raises a real acceptance question: when hover and disabled both match,
which generated rule wins? Test selector specificity, layers, importance and
authored order. For equal-priority rules, later matching overrides should win.
Otherwise the normal CSS cascade decides; source order alone cannot promise
disabled always wins.

Within compact syntax, repeated or reversed conditions need a documented result.
Prefer preserving source order with a useful warning where appropriate to
silently reordering `@lg` and `@md`. Do not invent special runtime precedence.

## 11. Tailwind integration and optionality

Tailwind remains an optional styling provider. Plain CSS style blocks must not
require it. The utility slice may initially require the Tailwind provider; a
missing provider should yield a clear configuration diagnostic, not silently
discard aliases or introduce a mandatory default theme.

Useful existing mechanisms include utility expansion through `@apply`, theme
variables and `@reference` for stylesheet context. These are possible integration
points, not a decision to call private Tailwind APIs. Validate a supported version
and a real project before choosing the adapter. See Tailwind's
[directives](https://tailwindcss.com/docs/functions-and-directives) and
[theme documentation](https://tailwindcss.com/docs/theme).

The provider boundary should supply theme-aware candidate resolution,
declarations/conditions, completion information and configuration invalidation.
Avoid reimplementing Tailwind's token scales, plugins, arbitrary values or
variant semantics inside the Auwla parser.

Tailwind scans source as text; it does not parse our shorthand into utility
candidates. `p:4` therefore needs an explicit expansion/integration step. Choose
either provider expansion into the local stylesheet or a supported way to feed
complete candidates to the utility build. Do not rely on accidental scanning of
generated temporary files. The same constraint applies to dynamic class
fragments. See [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files).

Global Tailwind setup, theme definitions and resets belong to the application's
stylesheet context. Do not inject or scope a fresh copy of the entire Tailwind
stylesheet for every component. Cache provider state by project/configuration,
invalidate it when referenced themes or plugins change, and preserve custom
utilities instead of assuming only built-in names exist.

## 12. Compilation, delivery and existing compiler continuity

Proposed flow:

```text
Authored .auwla module
  -> module/style boundary parser with authored ranges
     -> component source + mappings -> existing JSX+ -> compiler-next
     -> style syntax tree -> optional utility provider -> local selector transform
        -> CSS artifact + mappings + imported-theme dependencies
```

Use a proper CSS-aware parser and explicit extension nodes. Do not implement
utility expansion, selector rewriting or block extraction as chained regular
expression substitutions. Preserve authored positions for properties, values,
conditions, selectors and block boundaries.

The module integration must retain correct JavaScript source ranges after style
extraction. The TypeScript checking view excludes module CSS while preserving or
mapping subsequent code positions; the production path records style output.
Do not send the style block to TypeScript as malformed JSX.

The build adapter can expose CSS through a virtual stylesheet module. Development
HMR should replace the affected stylesheet without accumulating stale rules.
Production builds should extract and deduplicate styles with explicit ordering,
asset URLs and source maps. URL/import resolution must use the authored file's
location, not the temporary generated module directory.

SSR must collect styles without accessing `document`. Scope identifiers must be
deterministic for the same module across server and client, including normalized
module identity; absolute checkout paths must not make outputs disagree.
Distinguish stable module scope identity from cache/content hashes. Streaming,
lazy chunks, repeated component instances and adoption must not duplicate or
reorder styles unpredictably. Details remain acceptance work, not current claims.

Static responsive/state conditions compile to CSS. They do not require resize
listeners, component replay or new reactive scheduling. Resource ownership and
JavaScript semantics continue to belong to the existing compiler/runtime.

## 13. Highlighting, completion, hover and diagnostics

Highlighting and language features are separate deliverables. Registering an
embedded CSS scope does not automatically teach an editor our utility syntax or
provide completion. VS Code documents separate approaches for
[embedded language support](https://code.visualstudio.com/api/language-extensions/embedded-languages).

### Highlighting

Extend the shared grammar with a style-block region and scopes for selectors,
ordinary declarations, aliases, values, conditions, strings, comments and braces.
Highlight `p:4 @md:6` as style syntax, not quoted markup interpolation or
TypeScript decorators. Lexical recovery must work before the closing `</style>`
is typed and must not color all later JavaScript as CSS after a recoverable edit.

### Completion and hover

Reuse a CSS language service for normal CSS; Microsoft's
[CSS language service](https://github.com/microsoft/vscode-css-languageservice)
provides reusable functionality. Add Auwla-aware alias/condition completion and
optional provider-backed utility values. The external library does not already
understand our proposed syntax.

| Authored cursor | Expected assistance |
| --- | --- |
| `dis` | Ordinary CSS property completion |
| `display: ` | CSS values such as `grid` and `flex` |
| `p:` | Provider spacing candidates |
| `bg:blue-` | Theme-aware utility values |
| `p:4 @` | Valid breakpoint/state conditions in this context |
| `p:4 @md:` | Padding values, not arbitrary property names |
| `padding:4px @md:` | CSS padding values, lengths and functions, not utility scale tokens |
| `@md { ... }` | Ordinary properties and aliases within a rule |
| `class="ca"` | Local selector candidates such as `card` |

Hover targets should explain the alias, show resolved CSS and show the actual
configured breakpoint. Completion data and compiler output must use the same
theme snapshot. Class completion initially handles simple authored class names;
cross-file class rename and fully dynamic selectors need separate fidelity rules.

Maintain a CSS checking projection that preserves normal CSS ranges and records
generated spans for extensions. Route compact-chain requests through the extension
model for both ordinary properties and aliases; for an ordinary property's
override, ask the CSS service for that property's value context and map the edit
back to the override. Use the normal CSS service where its input is valid. A projection that
masks extension spans must not turn generated text into bogus authored warnings.

Map returned completion edits, diagnostics and hover ranges to the source. Reject
unsafe edits crossing generated-only spans; do not apply a broad generated-file
replacement to the author's style block. Formatting must likewise understand
extensions instead of giving the entire file to an ordinary CSS formatter.

### Incomplete source and errors

Editor assistance must remain useful for `p:`, `p:4 @`, `p:4 @md:`,
`padding:4px @md:` and an open condition block. Checking recovery must use the current text, not a stale last
successful stylesheet. Production compilation remains strict about unfinished
extension syntax.

Diagnostic categories should cover unknown aliases/conditions, unsupported
provider values, missing provider configuration, malformed condition values,
unclosed blocks, invalid extension placement and provider build failures. Assign
codes only when the formal spec adds the feature. Avoid duplicate native-CSS and
extension errors for the same span; preserve unrelated JavaScript diagnostics.

### Decoupled editor architecture

Keep parsing, mappings, theme data and CSS language-service integration independent
of the VS Code SDK. The thin editor adapter chooses the appropriate service for
the cursor and registers features. A language-server interface can let other
editors reuse that core. The existing TypeScript content mapper remains responsible
for JavaScript/TypeScript; it does not become a CSS engine.

## 14. Proposed file ownership

These are planned concept locations, not files that exist today:

| Planned location | Responsibility |
| --- | --- |
| `packages/jsx-plus/src/styles/` | Style boundaries, extension nodes, alias/condition parsing, expansion, scoping and CSS mappings, with focused tests |
| `packages/jsx-plus/src/styles/providers/` | Optional provider adapters and theme/configuration access; extract to a separate package if dependencies warrant it |
| `packages/jsx-plus/src/styles/tooling/` | Shared CSS checking projection, completion, hover, diagnostics and recovery |
| `packages/jsx-plus/src/editor/grammar.ts` | Extend the existing shared grammar with styling scopes |
| `packages/editor-vscode/src/` | Thin editor registration/routing and service lifecycle |
| `packages/jsx-plus/examples/` | Real styled authoring examples, including an expanded task board |
| `wiki2/spec/` | Formal grammar, semantics, diagnostic and conformance additions before implementation |
| `wiki2/styling.md` | Future implementation map once a styling slice is selected |

Build delivery work must follow the existing Vite integration boundaries after
the prototype proves its CSS artifact contract. Do not scatter experimental style
parsing through compiler-next. Any genuinely necessary compiler-next interop
change follows DX-34 and is recorded for reconciliation on the compiler branch.
Do not add packages or dependencies merely because this table proposes them.

## 15. Small implementation slices and acceptance

| Slice | Observable result | Evidence needed |
| --- | --- | --- |
| CSS-0: formal draft | Agreed first profile, grammar examples and error boundaries | Spec fixtures; distinguish user decisions from recommendations |
| CSS-1: ordinary local CSS | One real `.auwla` component with a static module style block | Build CSS, local/global isolation, mapping and baseline editor assistance |
| CSS-2: utility aliases | `p:4`, `bg:blue-600` mixed with ordinary declarations | Provider probe, custom theme, applied completion edits and cascade checks |
| CSS-3: responsive conditions | Compact and grouped breakpoint forms agree for ordinary CSS properties and utility aliases | Raw CSS lengths/functions and provider tokens, resize tests at exact thresholds, source order, incomplete-input completion |
| CSS-4: state conditions | Small explicit set such as hover/focus | Native selector equivalence, overlap and configured variant behavior |
| CSS-5: app integration | Task board uses the feature through development and production | HMR, URLs/imports, SSR/adoption, deduplication, style maps and desktop acceptance |

Editor support accompanies each syntax slice. Do not postpone every real editor
check until CSS-5 or claim CSS-1 is production-ready before delivery acceptance.
The staged approach may change when an example exposes a better boundary.

Useful acceptance cases include:

- Mixed aliases and ordinary multiline CSS; optional shorthand semicolons;
  strings/comments/functions containing `@`, braces and apparent closing tags.
- Two files with `.card`, two components in one file, imported children, portals,
  global styles, pseudo-elements, keyframes and nested native conditions.
- `p:4 @md:6 @lg:8` compared with its grouped equivalent; custom breakpoints;
  exact inclusive/exclusive edges; reversed and repeated conditions.
- `padding:4px @md: 30px` compared with grouped ordinary CSS, with and without
  spaces after colons; raw units/functions/lists preserved; completion at
  `padding:4px @md:`; ordinary-property conditions without Tailwind.
- Shorthand/longhand ordering, importance, layers and overlapping state rules.
- Missing Tailwind, customized theme and utilities, changed theme during editing,
  and ordinary class strings that already work today.
- Actual completion edits applied to authored files, hover ranges, CSS errors
  alongside JavaScript errors, emoji/CRLF mappings and incomplete-input recovery.
- Computed browser styles after resizing and interacting; stylesheet teardown,
  hot updates, repeated mounts and matching server/client scope identifiers.

Use real authoring files as acceptance inputs. Parser snapshots and provider mocks
alone do not prove browser behavior or editor installation. Run checks appropriate
to the selected slice; this design document itself needs link and content review,
not an application test suite.

## 16. Decisions to resolve before coding

1. Confirm local-by-default `<style>` and explicit `<style global>`, including
   whether more than one block is allowed and the escape for global selectors.
2. Select the initial alias table and resolve CSS-name collisions explicitly.
3. Specify declaration/chain termination, comment behavior, multiline values and
   override boundaries for both ordinary CSS properties and utility aliases.
   Support for ordinary properties is required, not an unresolved scope choice.
4. Choose the initial named conditions, theme/breakpoint source and overlap rules.
5. Probe the Tailwind integration API, optional dependency packaging and custom
   utility/configuration behavior before promising broad compatibility.
6. Specify selector transformation, keyframe ownership, specificity and stable
   server/client scope identity with actual examples.
7. Define the CSS artifact/build contract and the smallest useful editor-service
   surface; add corresponding formal fixtures and real authoring examples.

No code, runtime behavior or accepted syntax changes merely because these
questions are documented. The next concrete step is CSS-0: promote a small,
reviewable profile into the spec, then implement and verify that profile through
the existing compiler and decoupled editor boundaries.
