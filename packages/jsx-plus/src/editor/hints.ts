/**
 * Reactivity hints: what the compiler decided each binding is, shown beside its declaration, the
 * way an editor shows inferred types. In Auwla nothing in the code marks reactivity; `let count = 0`
 * is state because a component reads it and a handler writes it. These hints show that decision
 * where it is made, and the explanation uses the author's own code as its example: where the
 * value is written, what runs again, and what reads it.
 *
 * Editor-neutral: offsets into the authored text, a short label and a Markdown explanation.
 * Editor adapters (`packages/editor-vscode`) show them their own way. The facts come from
 * compiler-next's public analysis entry, through `checking/facts.ts`; nothing here classifies
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
  /** Short: `state`, `derived ← count`, `source`. */
  readonly label: string;
  /** Markdown, shown on hover. */
  readonly tooltip: string;
}

type Binding = CheckingFacts['bindings'][number];
type Write = Binding['writes'][number];

/** Kinds whose change reaches what depends on them. A constant or an opaque value never names one. */
const REACTIVE = new Set(['State', 'Derived', 'Prop', 'Source']);

/** Reassigning the binding itself. Calls, arguments and member writes may mutate its value instead. */
const REASSIGNMENTS = new Set(['assign', 'update']);

/** At most this many inputs are named in a label; the rest are counted. */
const NAMED_INPUTS = 3;

/** Example lines quoted in an explanation, and the longest one shown in full. */
const EXAMPLES = 2;
const EXAMPLE_LENGTH = 60;

/** One binding that gets a hint, before its explanation is written. */
interface Entry {
  readonly binding: Binding;
  readonly kind: ReactivityHintKind;
  readonly inputs: readonly string[];
  readonly start: number;
  readonly end: number;
}

/**
 * The hints for one `.auwla` module, in source order. A file that does not compile right now
 * (while typing) has none, rather than hints at positions that no longer hold.
 */
export function reactivityHints(source: string, filename = './App.auwla'): ReactivityHint[] {
  const facts = analyze(source, filename);
  if (facts === undefined || facts.status !== 'mapped') return [];

  const entries: Entry[] = [];
  for (const binding of facts.bindings) {
    if (!shown(binding)) continue;
    const declaration = binding.declarations[0];
    // Only a declaration copied verbatim from the author's text has a place to show the hint.
    if (declaration?.fidelity !== 'verbatim' || declaration.authored === null) continue;
    const inputs = inputsOf(binding, facts.bindings);
    const kind = hintKind(binding, inputs);
    if (kind === undefined) continue;
    entries.push({ binding, kind, inputs, start: declaration.authored[0], end: declaration.authored[1] });
  }

  // What reads each value: the hinted values that name it as an input.
  const readers = new Map<string, string[]>();
  for (const entry of entries) {
    for (const input of entry.inputs) readers.set(input, [...readers.get(input) ?? [], entry.binding.name]);
  }

  return entries
    .map((entry) => ({
      offset: entry.end,
      start: entry.start,
      kind: entry.kind,
      label: label(entry.kind, entry.inputs),
      tooltip: explain(source, entry, readers.get(entry.binding.name) ?? []),
    }))
    .sort((left, right) => left.offset - right.offset);
}

/**
 * A component's own bindings and module bindings. A local inside a callback or helper
 * (`const matches = ...` in a `.filter` callback) is recomputed on every call anyway.
 */
function shown(binding: Binding): boolean {
  return binding.componentOwned || binding.owner === null;
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

/** Writes in the component's body, which compute the value (`if (count > 10) message = 'yeah'`). */
function bodyAssignments(binding: Binding): Write[] {
  return binding.writes.filter((write) => write.timing === 'body' && REASSIGNMENTS.has(write.kind));
}

/** Writes from a handler or callback: someone changing the value later. */
function laterWrites(binding: Binding): Write[] {
  return binding.writes.filter((write) => write.timing === 'later');
}

/**
 * The reactive values a binding follows, in the order the code reads them: those its initializer
 * reads, including inside a callback it runs (`tasks.filter((task) => task.title.includes(query))`
 * reads `query`), which the compiler's static dependencies leave out. The static dependencies are
 * used when the body assigns the binding (`if (count > 10) message = 'yeah'` makes `message`
 * follow `count`) or it has no initializer. Otherwise they can name inputs nothing reads: in
 * `let tasks = [...]; let query = '';`, analysis lists `tasks` for `query`, yet writing `tasks`
 * leaves `query` alone (checked against the compiled code).
 */
function inputsOf(binding: Binding, bindings: readonly Binding[]): string[] {
  const byId = new Map(bindings.map((entry) => [entry.id, entry]));
  const initializer = binding.computation?.initializer?.authored ?? null;
  const reads = (input: Binding) => input.references
    .map((reference) => reference.range.authored)
    .filter((range): range is readonly [number, number] => range !== null);
  const firstRead = (input: Binding): number => {
    if (initializer === null) return Number.POSITIVE_INFINITY;
    const inside = reads(input).filter((range) => initializer[0] <= range[0] && range[1] <= initializer[1]);
    return inside.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...inside.map((range) => range[0]));
  };

  const inputs = new Set<Binding>();
  if (initializer === null || bodyAssignments(binding).length > 0) {
    for (const id of binding.computation?.dependencies ?? binding.dependencies) {
      const input = byId.get(id);
      if (input !== undefined) inputs.add(input);
    }
  }
  for (const other of bindings) {
    if (other !== binding && firstRead(other) !== Number.POSITIVE_INFINITY) inputs.add(other);
  }
  const order = (input: Binding) => Math.min(firstRead(input), ...reads(input).map((range) => range[0]));
  return [...inputs]
    .filter((input) => input !== binding && REACTIVE.has(input.kind) && shown(input))
    .sort((left, right) => order(left) - order(right))
    .map((input) => input.name);
}

function hintKind(binding: Binding, inputs: readonly string[]): ReactivityHintKind | undefined {
  const written = laterWrites(binding).some((write) => REASSIGNMENTS.has(write.kind));
  switch (binding.kind) {
    case 'State':
      // A component's local that nothing changes after its body ran never updates anything.
      // Module state can be written from other files, which this file cannot see.
      return binding.componentOwned && laterWrites(binding).length === 0 ? undefined : 'state';
    case 'Derived':
      if (!written) return 'derived';
      // Written later, and following nothing reactive (`let notes = [createNote(...)]`): plain state.
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

/** The explanation for one hint, with the author's own code as its examples. */
function explain(source: string, entry: Entry, readers: readonly string[]): string {
  const { binding, kind, inputs } = entry;
  const name = code(binding.name);
  const changes = `when ${either(inputs.map(code))} changes`;
  const initializer = binding.computation?.initializer?.authored ?? null;
  const computed = initializer === null ? undefined : quote(source.slice(...initializer));
  const loads = binding.kind === 'Source';
  const lines: string[] = [];

  switch (kind) {
    case 'state':
      lines.push(`**State** · ${name}`);
      lines.push(`Writing ${name} updates everything that reads it: the markup, values derived from it and effects.`);
      lines.push(...examples(source, 'Written', laterWrites(binding)));
      break;
    case 'derived':
      lines.push(`**Derived** from ${list(inputs.map(code))}`);
      if (bodyAssignments(binding).length > 0) {
        lines.push(`${name} is recomputed ${changes}: the code that assigns it runs again.`);
        lines.push(...examples(source, 'Assigned', bodyAssignments(binding)));
      } else {
        lines.push(`${name} is recomputed ${changes}${computed === undefined ? '' : `: ${computed} runs again`}.`);
      }
      if (loads) lines.push('It loads data, so the request runs again too, and the new value replaces the old one when it arrives.');
      break;
    case 'writable':
      lines.push(`**State derived** from ${list(inputs.map(code))}`);
      lines.push(`${name} starts from ${computed ?? list(inputs.map(code))} and is recomputed ${changes}. `
        + `Writing it keeps the written value until ${either(inputs.map(code))} changes again.`);
      lines.push(...examples(source, 'Written', laterWrites(binding)));
      break;
    case 'source':
      lines.push(`**Source** · loads data`);
      lines.push(`${name} arrives later${computed === undefined ? '' : `, from ${computed}`}. Until it does, markup that reads it waits.`);
      break;
  }
  if (readers.length > 0) lines.push(`Read by ${list(readers.map(code))}.`);
  return lines.join('\n\n');
}

/**
 * Writes worth quoting: assignments to the binding or one of its members. A method call or a loop
 * over the value is counted as a possible change (`query.toLowerCase()`), but quoting it as a
 * write would mislead.
 */
const QUOTED_WRITES = new Set(['assign', 'update', 'member', 'delete']);

/** `Written at line 31: search = event.currentTarget.value`, for the first few writes. */
function examples(source: string, verb: string, all: readonly Write[]): string[] {
  const writes = all.filter((write) => QUOTED_WRITES.has(write.kind));
  const shown = writes
    .map((write) => write.range.authored)
    .filter((range): range is readonly [number, number] => range !== null)
    .slice(0, EXAMPLES)
    .map((range) => `${verb} at line ${lineOf(source, range[0])}: ${quote(source.slice(...range))}`);
  const more = writes.length - shown.length;
  return more > 0 && shown.length > 0 ? [...shown, `…and ${more} more.`] : shown;
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r\n|\r|\n/).length;
}

/** Code on one line, shortened, as inline Markdown code. */
function quote(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return code(line.length > EXAMPLE_LENGTH ? `${line.slice(0, EXAMPLE_LENGTH - 1)}…` : line);
}

function code(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

/** `a`, `a and b`, `a, b and c`. */
function list(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** `a`, `a or b`, `a, b or c`. */
function either(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}
