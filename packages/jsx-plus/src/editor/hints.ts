/**
 * Reactivity hints: what the compiler decided each binding is, shown beside its declaration, the
 * way an editor shows inferred types. In Auwla nothing in the code marks reactivity; `let count = 0`
 * is state because a component reads it. These hints show that decision where it is made.
 *
 * Editor-neutral: offsets into the authored text, a short label and a Markdown explanation.
 * Editor adapters (`packages/editor-vscode`) turn them into their own inlay hints. The facts come
 * from compiler-next's public analysis entry, through `checking/facts.ts`; nothing here classifies
 * bindings itself.
 */
import { CompileError } from '@memoized-dom/compiler-next/analysis';
import { inspectCheckingFacts, type CheckingFacts } from '../checking/facts';

export type ReactivityHintKind = 'state' | 'derived' | 'writable' | 'source';

export interface ReactivityHint {
  /** Authored UTF-16 offset the hint sits at: just after the binding's declared name (and type). */
  readonly offset: number;
  /** Authored offset where that declaration starts: hovering from here to `offset` explains it. */
  readonly start: number;
  readonly kind: ReactivityHintKind;
  /** Short and faint: `state`, `derived ← count`, `source`. */
  readonly label: string;
  /** Markdown, for hovering the hint. */
  readonly tooltip: string;
}

type Binding = CheckingFacts['bindings'][number];

/** Kinds whose change reaches what depends on them. A constant or an opaque value never names one. */
const REACTIVE = new Set(['State', 'Derived', 'Prop', 'Source']);

/** At most this many inputs are named in a label; the rest are counted. */
const NAMED_INPUTS = 3;

/**
 * The hints for one `.auwla` module, in source order. A file that does not compile right now
 * (while typing) has none, rather than hints at positions that no longer hold.
 */
export function reactivityHints(source: string, filename = './App.auwla'): ReactivityHint[] {
  const facts = analyze(source, filename);
  if (facts === undefined || facts.status !== 'mapped') return [];

  const hints: ReactivityHint[] = [];
  for (const binding of facts.bindings) {
    if (!shown(binding)) continue;
    const declaration = binding.declarations[0];
    // Only a declaration copied verbatim from the author's text has a place to show the hint.
    if (declaration?.fidelity !== 'verbatim' || declaration.authored === null) continue;

    const inputs = inputsOf(binding, facts.bindings);
    const kind = hintKind(binding, inputs);
    if (kind === undefined) continue;
    // A source with inputs re-runs when they change: derived, and it loads (`getPeople(search)`).
    const loads = binding.kind === 'Source' && kind === 'derived';
    hints.push({
      offset: declaration.authored[1],
      start: declaration.authored[0],
      kind,
      label: label(kind, inputs),
      tooltip: tooltip(kind, binding.name, inputs, loads),
    });
  }
  return hints.sort((left, right) => left.offset - right.offset);
}

/**
 * A component's own bindings and module bindings. A local inside a callback or helper
 * (`const matches = ...` in a `.filter` callback) is recomputed on every call anyway.
 */
function shown(binding: Binding): boolean {
  return binding.componentOwned || binding.owner === null;
}

/**
 * The reactive values a binding follows: those its initializer reads, in reading order. That
 * includes reads inside a callback the initializer runs
 * (`tasks.filter((task) => task.title.includes(query))` reads `query`), which the compiler's
 * static dependencies leave out. Those dependencies also name inputs nothing reads: in
 * `let tasks = [...]; let query = '';`, analysis lists `tasks` for `query`, yet writing `tasks`
 * leaves `query` alone (checked against the compiled code). So they are used only for a binding
 * with no initializer.
 */
function inputsOf(binding: Binding, bindings: readonly Binding[]): string[] {
  const byId = new Map(bindings.map((entry) => [entry.id, entry]));
  const initializer = binding.computation?.initializer?.authored ?? null;
  const firstRead = (input: Binding): number => {
    if (initializer === null) return Number.POSITIVE_INFINITY;
    const inside = input.references
      .map((reference) => reference.range.authored)
      .filter((range): range is readonly [number, number] => range !== null && initializer[0] <= range[0] && range[1] <= initializer[1]);
    return inside.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...inside.map((range) => range[0]));
  };

  const inputs = new Set<Binding>();
  if (initializer === null) {
    for (const id of binding.computation?.dependencies ?? binding.dependencies) {
      const input = byId.get(id);
      if (input !== undefined) inputs.add(input);
    }
  }
  for (const other of bindings) {
    if (other !== binding && firstRead(other) !== Number.POSITIVE_INFINITY) inputs.add(other);
  }
  return [...inputs]
    .filter((input) => REACTIVE.has(input.kind) && shown(input))
    .map((input) => ({ name: input.name, at: firstRead(input) }))
    .sort((left, right) => left.at - right.at)
    .map((input) => input.name);
}

/**
 * The module's facts, or none while it does not compile. One file is analyzed alone, so a
 * `route-to` naming a route that another file declares (`<a route-to="/people/:id">` in a page,
 * routes in `App.auwla`) fails here though the app compiles. Routes do not change what a binding
 * is, so that file is analyzed again with each `route-to` read as a plain attribute of the same
 * length (`data-rto`): every offset stays where it was, and the attribute's value is still read.
 */
function analyze(source: string, filename: string): CheckingFacts | undefined {
  try {
    return inspectCheckingFacts(source, filename);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    if (!error.message.includes('route-to')) return undefined;
  }
  try {
    return inspectCheckingFacts(source.replace(/\broute-to(?=\s*=)/g, 'data-rto'), filename);
  } catch (error) {
    if (error instanceof CompileError) return undefined;
    throw error;
  }
}

/** Reassigning the binding itself. Calls, arguments and member writes may mutate its value instead. */
const REASSIGNMENTS = new Set(['assign', 'update']);

function hintKind(binding: Binding, inputs: readonly string[]): ReactivityHintKind | undefined {
  switch (binding.kind) {
    case 'State': return 'state';
    case 'Derived':
      if (!binding.writes.some((write) => REASSIGNMENTS.has(write.kind))) return 'derived';
      // Written, and following nothing reactive (`let notes = [createNote(...)]`): plain state.
      return inputs.length > 0 ? 'writable' : 'state';
    // With inputs it re-runs when they change, so it is derived; with none it is only a source.
    case 'Source': return inputs.length > 0 ? 'derived' : 'source';
    // Props, refs, constants and opaque values: no hint, to keep the editor quiet.
    default: return undefined;
  }
}

function label(kind: ReactivityHintKind, inputs: readonly string[]): string {
  const named = inputs.slice(0, NAMED_INPUTS).join(', ');
  const from = inputs.length === 0 ? '' : ` ← ${named}${inputs.length > NAMED_INPUTS ? `, +${inputs.length - NAMED_INPUTS}` : ''}`;
  switch (kind) {
    case 'state': return 'state';
    case 'derived': return `derived${from}`;
    case 'writable': return `state${from}`;
    case 'source': return 'source';
  }
}

function tooltip(kind: ReactivityHintKind, name: string, inputs: readonly string[], loads: boolean): string {
  const code = (text: string) => `\`${text}\``;
  const list = inputs.map(code).join(', ');
  const changes = inputs.length === 1 ? `${list} changes` : 'one of them changes';
  switch (kind) {
    case 'state':
      return `**State.** What reads ${code(name)} (markup, derived values, effects) updates when it is written.`;
    case 'derived':
      return `**Derived** from ${list || 'reactive values'}. Recomputed when ${inputs.length === 1 ? 'it changes' : 'one of them changes'}.`
        + (loads ? ` It loads data: when ${changes} the request runs again, and the new value replaces the old one when it arrives.` : '');
    case 'writable':
      return `**State derived** from ${list || 'reactive values'}. Writing ${code(name)} overrides it until ${changes}; `
        + 'then it is recomputed.';
    case 'source':
      return `**Source.** Its value arrives later; what reads ${code(name)} waits for it.`;
  }
}
