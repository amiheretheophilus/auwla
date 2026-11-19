/**
 * Stale checks, in a dev server's browser build only (`staleChecks` in the compiler's options).
 *
 * A derived value updates when something it reads reports a change. An edit the compiler cannot
 * see reports nothing: one made in a file it does not compile, inside a library, or through a
 * value it cannot follow. The value then keeps showing what it was, with no error.
 *
 * The compiler registers each component's plain derived values: how to read one, and how to
 * compute it again. A while after updates finish, this computes each again and compares. A value
 * that still differs at a second look, with no update pending in between, and computes to the same
 * thing both times, is out of date. The console says which one, what it holds, what it should
 * hold, and what it reads.
 *
 * Only after a commit: an edit nobody heard starts no commit of its own, but the next one, from
 * any click, finds what it left behind. Set `globalThis.__MEMOIZED_DOM_STALE_CHECKS__ = false`
 * to turn the checks off.
 */
import {
  getActiveApplicationRuntime,
  onCommitFinished,
  onEntityDispose,
  runInApplicationRuntime,
  type ApplicationRuntime,
  type Entity,
} from './kernel';
import { untracked } from './computation';

/** One derived value of a component, as the compiler registers it. */
export interface StaleCheck {
  /** The binding's name. */
  readonly name: string;
  /** The names it reads, which should have reported the change. */
  readonly inputs: readonly string[];
  /** Its current value. */
  readonly read: () => unknown;
  /** Its initializer, computed again. */
  readonly compute: () => unknown;
}

interface Watched {
  /** `./src/App.auwla#App`: where the component is defined. */
  readonly component: string;
  readonly checks: readonly StaleCheck[];
}

interface StaleStore {
  readonly runtime: ApplicationRuntime;
  readonly watched: Map<string, Watched>;
  /**
   * Checks that differed at the last look, with what computing again gave then. One more look,
   * with nothing pending, confirms it.
   */
  readonly suspects: Map<StaleCheck, unknown>;
  /** Reported, or found to give another value at every computation: never looked at again. */
  readonly done: WeakSet<StaleCheck>;
  timer: ReturnType<typeof setTimeout> | null;
}

const STORE = 'mmd:stale-checks';

/** Long enough for an update's own follow-up work (a source settling, an effect) to finish. */
const AFTER_COMMIT_MS = 300;
const CONFIRM_MS = 1000;

/** How much of one value a comparison walks before it gives up and calls the two the same. */
const COMPARE_BUDGET = 5000;

/** The store, only where a component registered checks: other runtimes allocate nothing. */
function existingStore(): StaleStore | undefined {
  return getActiveApplicationRuntime().state.extensions.get(STORE) as StaleStore | undefined;
}

function turnedOff(): boolean {
  try {
    return (globalThis as { __MEMOIZED_DOM_STALE_CHECKS__?: unknown }).__MEMOIZED_DOM_STALE_CHECKS__ === false;
  } catch {
    return false;
  }
}

export function watchStale(entity: Entity, component: string, checks: readonly StaleCheck[]): void {
  if (checks.length === 0 || typeof setTimeout !== 'function') return;
  const runtime = getActiveApplicationRuntime();
  const extensions = runtime.state.extensions;
  let store = extensions.get(STORE) as StaleStore | undefined;
  if (store === undefined) {
    store = { runtime, watched: new Map(), suspects: new Map(), done: new WeakSet(), timer: null };
    extensions.set(STORE, store);
  }
  store.watched.set(entity.id, { component, checks });
}

onEntityDispose((id) => {
  const store = existingStore();
  if (store === undefined) return;
  for (const check of store.watched.get(id)?.checks ?? []) store.suspects.delete(check);
  store.watched.delete(id);
});

onCommitFinished(() => {
  const store = existingStore();
  if (store !== undefined) schedule(store, AFTER_COMMIT_MS);
});

function schedule(store: StaleStore, delay: number): void {
  if (store.timer !== null) return;
  store.timer = setTimeout(() => {
    store.timer = null;
    runInApplicationRuntime(store.runtime, () => checkAll(store));
  }, delay);
}

function checkAll(store: StaleStore): void {
  if (turnedOff()) return;
  const kernel = store.runtime.state;
  // An update still to run would make a correct value look old.
  if (kernel.inCommit || kernel.dirty.size > 0) {
    schedule(store, AFTER_COMMIT_MS);
    return;
  }
  let confirm = false;
  for (const { component, checks } of store.watched.values()) {
    for (const check of checks) {
      if (store.done.has(check)) continue;
      const found = compare(check);
      if (found === null) {
        store.suspects.delete(check);
        continue;
      }
      if (!store.suspects.has(check)) {
        store.suspects.set(check, found.fresh);
        confirm = true;
        continue;
      }
      const before = store.suspects.get(check);
      store.suspects.delete(check);
      store.done.add(check);
      // Computing it gave another value a second later with nothing edited in between: it reads
      // the clock or chance (`Math.random() + count`), and is never expected to keep up.
      if (!same(before, found.fresh)) continue;
      report(component, check, found.held, found.fresh);
    }
  }
  if (confirm) schedule(store, CONFIRM_MS);
}

function same(left: unknown, right: unknown): boolean {
  return sameData(left, right, new Map(), { left: COMPARE_BUDGET });
}

/** The two values when computing again gives another one; null when they agree or cannot be compared. */
function compare(check: StaleCheck): { held: unknown; fresh: unknown } | null {
  let held: unknown;
  let fresh: unknown;
  try {
    held = untracked(check.read);
    fresh = untracked(check.compute);
  } catch {
    // Waiting for data, or a computation that fails right now: nothing to say about it.
    return null;
  }
  return same(held, fresh) ? null : { held, fresh };
}

/**
 * Whether two values hold the same data. Computing a list again makes a new array, so values
 * compare by what they hold, not by identity. Functions compare equal: computing again makes new
 * closures. Anything this cannot judge counts as the same, so a report is never a guess.
 */
function sameData(left: unknown, right: unknown, seen: Map<object, object>, budget: { left: number }): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left === 'function' && typeof right === 'function') return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (--budget.left <= 0) return true;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  try {
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
    // Nodes and promises have no data to compare.
    if (typeof (left as { nodeType?: unknown }).nodeType === 'number' || left instanceof Promise) return true;
    if (left instanceof Date) return left.getTime() === (right as Date).getTime();
    if (left instanceof Map) return sameEntries([...left], [...(right as Map<unknown, unknown>)], seen, budget);
    if (left instanceof Set) return sameEntries([...left], [...(right as Set<unknown>)], seen, budget);
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      const leftField = Object.getOwnPropertyDescriptor(left, key);
      const rightField = Object.getOwnPropertyDescriptor(right, key);
      // A getter is not run only to compare.
      if (leftField === undefined || rightField === undefined || !('value' in leftField) || !('value' in rightField)) continue;
      if (!sameData(leftField.value, rightField.value, seen, budget)) return false;
    }
    return true;
  } catch {
    // A proxy that refuses to answer.
    return true;
  }
}

function sameEntries(left: readonly unknown[], right: readonly unknown[], seen: Map<object, object>, budget: { left: number }): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => sameData(entry, right[index], seen, budget));
}

function report(component: string, check: StaleCheck, held: unknown, fresh: unknown): void {
  const [file, name] = splitComponent(component);
  const inputs = check.inputs.length === 0 ? '' : ` (${check.inputs.map((input) => `\`${input}\``).join(', ')})`;
  const lines = [
    `[memoized-dom] \`${check.name}\` in ${name} (${file}) is out of date.`,
    `It holds ${describe(held)}, but computing it again gives ${describe(fresh)}.`,
    `Nothing it reads${inputs} reported a change, so it didn't update.`,
    'Something edited that data where the compiler couldn\'t see it: in a file it doesn\'t compile, '
      + 'inside a library, or through a value it can\'t follow. Make the edit in compiled code, '
      + 'or assign a new value instead of editing it in place.',
  ];
  try {
    console.warn(lines.join('\n'), { holds: held, computedAgain: fresh });
  } catch {
    // A broken console must never affect the application.
  }
}

function splitComponent(component: string): [string, string] {
  const hash = component.lastIndexOf('#');
  return hash < 0 ? [component, 'a component'] : [component.slice(0, hash), component.slice(hash + 1)];
}

/** A short description for the message; the values themselves follow it for inspection. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  if (value instanceof Map || value instanceof Set) return `${value.size} ${value.size === 1 ? 'entry' : 'entries'}`;
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (value === null || typeof value !== 'object') return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  } catch {
    return 'an object';
  }
}
