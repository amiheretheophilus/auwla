/**
 * Host globals the program writes (`wiki/compiler/state-and-derived.md`, "A global the program
 * never writes is not an input"). A global the program assigns is an input: compiled code reads
 * it through `trackGlobal` and announces each write with `publishGlobal`, so a site in any
 * component that read it updates, as the reference shows.
 *
 * Globals belong to the page, not to one application, so their versions are process-wide.
 */
import { publishVersions, trackRead } from './computation';

interface GlobalEntry {
  count: number;
  readonly version: () => number;
}

const entries = new Map<string, GlobalEntry>();

function entryOf(name: string): GlobalEntry {
  let entry = entries.get(name);
  if (entry === undefined) {
    const created: GlobalEntry = { count: 0, version: () => created.count };
    entries.set(name, entry = created);
  }
  return entry;
}

/** Stands for every global: a computed read (`window[key]`) depends on all of them. */
const ANY = '*';

/**
 * A read of the written global `name`, or of one whose name is computed (`null`): the running
 * computation now depends on it. Returns `value`, so the read keeps its place in an expression.
 */
export function trackGlobal<T>(name: string | null, value: T): T {
  const entry = entryOf(name ?? ANY);
  return trackRead(entry.version, value, entry);
}

/**
 * A write of the global `name` happened, giving `value`, which is returned so the write keeps its
 * value as an expression. `null` is a write whose name is not known (`window[key] = 1`, or code
 * run from text), which may have changed any of them. Every write reaches a computed read.
 */
export function publishGlobal<T>(name: string | null, value: T): T {
  const changed = name === null ? [...entries.values()] : [entryOf(name), entryOf(ANY)];
  for (const entry of changed) entry.count++;
  if (changed.length > 0) publishVersions(changed);
  return value;
}

/**
 * The program runs code from text (`eval`, `Function`), which can write any global without the
 * compiler seeing it. Then each event handler's end counts as a write of every global.
 */
let codeFromText = false;

export function noteCodeFromText(): void {
  codeFromText = true;
}

/** Called when the outermost event handler returns (`write-batch.ts`). */
export function publishGlobalsAfterHandler(): void {
  if (codeFromText) publishGlobal(null, undefined);
}
