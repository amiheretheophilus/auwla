/**
 * Runtime of the reference renderer (wiki/compiler/testing.md). Test-only.
 *
 * This is not how the framework renders. It is the simplest renderer that is
 * still correct, so compiled output can be checked against it:
 *
 * - every render calls every component again. The component body is setup code:
 *   `transform.ts` makes everything except derivations run on the first render only;
 * - DOM nodes are kept between renders, matched by authored site, position, key and tag, so refs,
 *   typed text and focus survive. Each render updates their props and order;
 * - after the DOM is updated, refs are installed and effects run. If that changed
 *   anything, the app renders again, until nothing changes.
 *
 * Values that must outlive one render live in slots of the component instance.
 */
import { $waiting, enterSourceOwner, Group, noteReplacement, Source, Waiting } from './sources';
import { childPosition, elementPosition, isElement, Preparation } from './preparation';
export {
  $branch, $fetch, $path, $read, $switch, $track, $value, $waiting, $when, $sourceState, Group,
} from './sources';

// ---------------------------------------------------------------------------
// JSX

export interface Element {
  tag: string | typeof Fragment | typeof Group | Component;
  props: Record<string, unknown>;
  children: unknown[];
  site: unknown;
}

export type Component = (props: Record<string, unknown>) => unknown;

export const Fragment = Symbol('Fragment');

/** The JSX factory of transformed modules. */
export function $h(tag: Element['tag'], props: Record<string, unknown> | null, ...children: unknown[]): Element {
  const { $referenceSite: site, ...values } = props ?? {};
  return { tag, props: values, children, site };
}

// ---------------------------------------------------------------------------
// Refs

/**
 * `ref={x}` is transformed into `ref={$assignRef(() => x, (node) => { x = node; })}`,
 * so the runtime can fill the variable and clear it again.
 */
export class AssignRef {
  constructor(
    readonly get: () => unknown,
    readonly set: (node: unknown) => void,
  ) {}
}

export function $assignRef(get: () => unknown, set: (node: unknown) => void): AssignRef {
  return new AssignRef(get, set);
}

/** Install one `ref` value on a node. Returns its teardown. */
function installRef(value: unknown, node: Node): (() => void) | undefined {
  if (value === null || value === undefined || value === false) return undefined;

  if (Array.isArray(value)) {
    // Set up left to right, tear down right to left.
    const teardowns = value.map((entry) => installRef(entry, node));
    return () => {
      for (const teardown of teardowns.reverse()) teardown?.();
    };
  }

  if (value instanceof AssignRef) {
    // A variable that holds a forwarded ref (a component's `ref` prop) forwards it.
    const current = value.get();
    if (current instanceof AssignRef || typeof current === 'function') return installRef(current, node);
    value.set(node);
    return () => {
      // Cleared only if it still holds this node.
      if (value.get() === node) value.set(undefined);
    };
  }

  if (typeof value === 'function') {
    const teardown = value(node);
    return typeof teardown === 'function' ? (teardown as () => void) : undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Component instances and their slots

interface ReadValue {
  peek(): unknown;
}

function readValues(reads: Iterable<ReadValue>): unknown[] {
  return [...reads].map((read) => read.peek());
}

/** Reads and writes observed during one actual synchronous computation. */
interface Computation {
  reads: Set<ReadValue>;
  writes: Set<MemoSlot>;
  pending?: Waiting;
}

let computation: Computation | undefined;
const externalReads = new Map<string, ReadValue>();
const privateVersions = new WeakMap<object, number>();

/** Native private stores cannot be inspected by a descriptor snapshot. */
export function $privateTarget(read: () => unknown, write: (value: unknown) => void, object: object) {
  return {
    get v() { return read(); },
    set v(value: unknown) {
      write(value);
      privateVersions.set(object, (privateVersions.get(object) ?? 0) + 1);
    },
  };
}

/** Module bindings remain native variables; record only reads that actually execute. */
export function $captureRead(key: string, read: () => unknown): unknown {
  let dependency = externalReads.get(key);
  if (dependency === undefined) {
    dependency = { peek: read };
    externalReads.set(key, dependency);
  }
  computation?.reads.add(dependency);
  return read();
}

/** A binding in a helper or factory, read by a function it created (`closures.ts`): one cell per invocation. */
export function $closureCell(read: () => unknown): ReadValue {
  return { peek: read };
}

/** Record the cell in the running computation. A hoisted `var` cell can still be undefined. */
export function $closureRead(cell: ReadValue | undefined, read: () => unknown): unknown {
  if (cell !== undefined) computation?.reads.add(cell);
  return read();
}

class MemoSlot {
  private value: unknown;
  writtenLater = false;

  readonly created: number;
  constructor(readonly owner: Instance) { this.created = owner.render; }

  get v(): unknown {
    computation?.reads.add(this);
    return this.value;
  }

  set v(value: unknown) {
    // A shared body statement may still rebuild another value. Its write must
    // not take this binding back from a handler that already took control.
    if (rendering === this.owner && this.writtenLater) return;
    noteReplacement(this.value, value);
    this.value = value;
    computation?.writes.add(this);
    if (rendering === this.owner) return;

    // Compare owners, not just "is some component rendering?". A child can
    // invoke a callback that writes its parent's binding.
    this.writtenLater = true;
    this.pending = undefined;
  }

  seed(value: unknown): void {
    this.value = value;
  }

  /** Reading saved dependencies must not record new authored reads. */
  peek(): unknown {
    return this.value;
  }

  /** True on the render where the value was computed again. */
  fresh = false;
  /** Deep copy of the inputs it was computed from. */
  inputs: unknown;
  /** Sources discovered when a helper returned a waiting computation. */
  sources: readonly Source[] = [];
  /** Statements that build it still wait for a source (`$ready`). */
  pending: Waiting | undefined;
  /** A callback used by the initializer may discover readiness only when called. */
  callbackSources: readonly Source[] = [];
  reads = new Set<ReadValue>();
  /** Refresh a shared builder's inputs after all of its outputs have settled. */
  readInputs: (() => unknown[]) | undefined;
}

class PropSlot extends MemoSlot {
  constructor(owner: Instance, public fromParent: unknown) {
    super(owner);
    this.seed(fromParent);
  }
}

/**
 * A slot's value as an input of rendering, derivations and effects: waiting
 * while statements that build it wait for a source. Handlers read `slot.v`, the
 * value JavaScript has now.
 */
export function $ready(slot: { v: unknown; pending: Waiting | undefined }): unknown {
  return slot.pending ?? slot.v;
}

interface EffectSlot {
  inputs: unknown;
  teardown: (() => void) | undefined;
  readInputs: () => unknown[];
  callback: () => unknown;
  hasRun: boolean;
  reads: Set<ReadValue>;
}

export class Instance {
  readonly sources = new Set<Source>();
  /** True during the instance's first render. */
  first = true;
  /** How many times the instance has rendered. A memo that reads it is computed on every render. */
  render = 0;
  private readonly slots = new Map<number, MemoSlot>();
  private readonly effects = new Map<number, EffectSlot>();
  /** Effects called during the current render; the others are destroyed. */
  private readonly calledEffects = new Set<number>();
  private readonly cleanups: Array<() => void> = [];
  /** `"statement:position"` pairs from `observe`: that statement changed that value. */
  private readonly confirmations = new Set<string>();
  private readonly statementsRun = new Set<number>();
  /** `observe` indexes that have run at least once. */
  private readonly observed = new Set<number>();
  private readonly computations = new Map<number, Computation>();
  private readonly functions = new Map<number, Function>();

  /** Setup creates a nested declaration once, just as it creates local state. */
  retainFunction<T extends Function>(index: number, value: T): T {
    const previous = this.functions.get(index);
    if (previous !== undefined) {
      return previous as T;
    }
    this.functions.set(index, value);
    return value;
  }

  /** A prop the component reassigns: the override holds until the parent passes a different value. */
  prop(index: number, fromParent: unknown): PropSlot {
    let slot = this.slots.get(index) as PropSlot | undefined;
    if (slot === undefined) {
      slot = new PropSlot(this, fromParent);
      this.slots.set(index, slot);
    } else if (!Object.is(slot.fromParent, fromParent)) {
      slot.seed(fromParent);
      slot.writtenLater = false;
      slot.fromParent = fromParent;
    }
    return slot;
  }

  /**
   * A derived value: computed again only when one of its inputs changes.
   * `readPending` lists what the body statements that build it read.
   */
  memo(index: number, readInputs: () => unknown[], compute: () => unknown, readPending?: () => unknown[]): MemoSlot {
    let slot = this.slots.get(index) as MemoSlot | undefined;
    if (slot?.writtenLater) {
      slot.fresh = false;
      slot.pending = undefined;
      return slot;
    }
    const dependencies = this.dependenciesOf(slot);
    const values = [...readInputs(), ...readValues(dependencies)];
    const inputs = deepCopy([...values, ...(slot?.sources ?? [])]);

    if (slot === undefined) {
      slot = new MemoSlot(this);
      this.slots.set(index, slot);
    }
    slot.readInputs = readInputs;
    if (slot.inputs === undefined || !deepEqual(slot.inputs, inputs)) {
      const outer = computation;
      const trace: Computation = { reads: new Set(), writes: new Set() };
      computation = trace;
      const value = compute();
      computation = outer;
      noteReplacement(slot.peek(), value);
      slot.seed(value);
      slot.fresh = true;
      slot.reads = trace.reads;
      slot.callbackSources = trace.pending?.sources ?? [];
      if (value instanceof Waiting) slot.sources = value.sources;
      slot.inputs = deepCopy([...readInputs(), ...readValues(this.dependenciesOf(slot)), ...slot.sources]);
    } else {
      slot.fresh = false;
    }
    const waitingInputs = readPending?.() ?? [];
    waitingInputs.push(...slot.callbackSources);
    for (const trace of this.computations.values()) {
      if (trace.pending === undefined || !trace.writes.has(slot)) continue;
      waitingInputs.push(...trace.pending.sources);
    }
    slot.pending = $waiting(waitingInputs);
    return slot;
  }

  private dependenciesOf(slot: MemoSlot | undefined): Set<ReadValue> {
    const dependencies = new Set(slot?.reads);
    if (slot === undefined) return dependencies;

    for (const trace of this.computations.values()) {
      if (!trace.writes.has(slot)) continue;
      for (const read of trace.reads) {
        // `total += item.price` reads the accumulator as part of building it;
        // that read must not make the derivation depend on its own output.
        if (!(read instanceof MemoSlot) || !trace.writes.has(read)) dependencies.add(read);
      }
    }
    // An initializer can read another output of a shared builder. Once that
    // statement has run, neither output is an external dependency of the group.
    // Keep later overrides: they are inputs now, rather than rebuilt outputs.
    for (const trace of this.computations.values()) {
      if (!trace.writes.has(slot)) continue;
      for (const target of trace.writes) {
        if (!target.writtenLater) dependencies.delete(target);
      }
    }
    return dependencies;
  }

  /** Guard an actual body invocation, never the act of registering a callback. */
  callback(readInputs: () => unknown[], run: () => unknown, targets: MemoSlot[]): unknown {
    if (rendering !== this) return run();
    const pending = $waiting(readInputs());
    if (pending !== undefined && computation !== undefined) {
      computation.pending = pending;
    }

    for (const target of targets) {
      if (target.writtenLater) continue;
      target.pending = pending;
      if (pending !== undefined) computation?.writes.add(target);
    }
    if (pending !== undefined) return pending;
    return run();
  }

  /** `$effect(callback)`: runs after the commit when it is new or its inputs changed. */
  effect(index: number, readInputs: () => unknown[], callback: () => unknown): void {
    this.calledEffects.add(index);
    const slot = this.effects.get(index);

    if (slot === undefined) {
      this.effects.set(index, {
        inputs: undefined,
        teardown: undefined,
        readInputs,
        callback,
        hasRun: false,
        reads: new Set(),
      });
    } else {
      slot.readInputs = readInputs;
      slot.callback = callback;
    }
  }

  /** `$cleanup(fn)`: runs once, when the instance is unmounted. */
  cleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /**
   * Run body statement `index`, which calls something that may change the values
   * `readValues` returns. Each value that did change is confirmed: from then on the
   * statement builds it (`confirmed(index, position)`).
   */
  observe(index: number, readValues: () => unknown[], run: () => void): void {
    const before = readValues().map((value) => deepCopy(value));
    run();
    this.observed.add(index);
    readValues().forEach((value, position) => {
      if (!deepEqual(before[position], deepCopy(value))) this.confirmations.add(`${index}:${position}`);
    });
  }

  /** Whether statement `index` was seen to change the value at `position`. */
  confirmed(index: number, position: number): boolean {
    return this.confirmations.has(`${index}:${position}`);
  }

  /**
   * Whether statement `index` may change the value at `position`: it was seen to,
   * or it has not run yet (it waits for a source), so nobody knows. Until then the
   * value waits for what the statement reads.
   */
  mayChange(index: number, position: number): boolean {
    return !this.observed.has(index) || this.confirmed(index, position);
  }

  ran(index: number): boolean {
    return this.statementsRun.has(index);
  }

  /** Immediate callbacks can build a value even when no static call summary exists. */
  due(index: number): boolean {
    const writes = this.computations.get(index)?.writes;
    if (writes === undefined) return false;
    return [...writes].some((slot) => slot.fresh && !slot.writtenLater);
  }

  /**
   * A body statement runs once its sources are ready. Skip it after later code
   * has taken over every value it builds. If another target still derives, keep
   * replaying the statement; each slot setter protects its own later override.
   */
  statement(index: number, readInputs: () => unknown[], run: () => void, builds: MemoSlot[] = []): void {
    const targets = [...builds, ...(this.computations.get(index)?.writes ?? [])];
    if (targets.length > 0 && targets.every((slot) => slot.writtenLater)) {
      this.statementsRun.add(index);
      return;
    }
    if ($waiting(readInputs())) return;
    const outer = computation;
    const trace: Computation = { reads: new Set(), writes: new Set() };
    computation = trace;
    run();
    computation = outer;
    this.computations.set(index, trace);
    if (trace.writes.size > 1) {
      for (const target of trace.writes) {
        if (target.readInputs === undefined || target.writtenLater) continue;
        target.inputs = deepCopy([
          ...target.readInputs(), ...readValues(this.dependenciesOf(target)), ...target.sources,
        ]);
      }
    }
    this.statementsRun.add(index);
  }

  /** Statement `index` inside a returning block: the render it was last reached in, and what it read after it ran. */
  private readonly returningRuns = new Map<number, { render: number; inputs: unknown }>();

  /**
   * A plain statement inside a block that returns (`wiki/decisions.md`,
   * 2026-10-24): it runs when reached and what it reads changed since it last
   * ran, or when it was not reached on the previous render. The inputs are
   * recorded after it runs, so its own writes do not make it run again.
   */
  returning(index: number, readInputs: () => unknown[], run: () => void): void {
    const previous = this.returningRuns.get(index);
    const stays = previous !== undefined
      && previous.render === this.render - 1
      && deepEqual(previous.inputs, deepCopy(readInputs()));
    if (!stays) run();
    this.returningRuns.set(index, { render: this.render, inputs: deepCopy(readInputs()) });
  }

  /** Called before each render of the instance. */
  beginRender(): void {
    this.render++;
    this.calledEffects.clear();
  }

  /** Initial setup runs in native order; a settling render must not execute it twice. */
  finishSetup(): void {
    for (const slot of this.slots.values()) {
      if (slot.created !== this.render || slot.readInputs === undefined || slot.writtenLater) {
        continue;
      }
      // Later body statements may change an input after an initializer captured
      // its value. Seed the baseline after setup so settling does not replay it.
      slot.inputs = deepCopy([
        ...slot.readInputs(),
        ...readValues(this.dependenciesOf(slot)),
        ...slot.sources,
      ]);
    }
  }

  /** Run the effects that are due. Returns whether any ran. */
  runEffects(): boolean {
    let ran = false;
    for (const [index, slot] of this.effects) {
      if (!this.calledEffects.has(index)) {
        // Not called this render (its `if` is false now): destroyed.
        slot.teardown?.();
        this.effects.delete(index);
        ran = true;
        continue;
      }
      // Inputs are read after refs mount, at the same time as the callback.
      const values = [...slot.readInputs(), ...readValues(slot.reads)];
      if ($waiting(values)) continue;
      const inputs = deepCopy(values);
      if (slot.hasRun && deepEqual(slot.inputs, inputs)) continue;
      slot.hasRun = true;
      slot.teardown?.();
      slot.teardown = undefined;
      const outer = computation;
      const trace: Computation = { reads: new Set(), writes: new Set() };
      computation = trace;
      const result = slot.callback();
      computation = outer;
      slot.reads = new Set([...trace.reads].filter((read) => {
        return !(read instanceof MemoSlot) || !trace.writes.has(read);
      }));
      settleTeardown(result, (teardown) => (slot.teardown = teardown));
      // The effect already saw its own synchronous writes. They update the UI,
      // but do not immediately re-trigger this effect.
      slot.inputs = deepCopy([...slot.readInputs(), ...readValues(slot.reads)]);
      ran = true;
    }
    return ran;
  }

  /** Source-dependent effects belong to the active subtree, but cannot run off-screen. */
  waitingEffects(): Waiting | undefined {
    return $waiting([...this.effects].flatMap(([index, slot]) =>
      this.calledEffects.has(index) ? slot.readInputs() : []));
  }

  unmount(): void {
    for (const slot of this.effects.values()) slot.teardown?.();
    this.effects.clear();
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.cleanups.length = 0;
    for (const source of this.sources) source.release(this.sources);
    this.sources.clear();
  }
}

/** An effect's teardown is the function it returns, or the function its promise resolves to. */
function settleTeardown(result: unknown, store: (teardown: () => void) => void): void {
  if (typeof result === 'function') {
    store(result as () => void);
  } else if (result instanceof Promise) {
    void result.then((value) => {
      if (typeof value === 'function') store(value as () => void);
    });
  }
}

let rendering: Instance | null = null;

/** Called first in every transformed component: the instance being rendered. */
export function $enter(): Instance {
  if (rendering === null) throw new Error('reference: a component was called outside a render');
  return rendering;
}

// ---------------------------------------------------------------------------
// Module effects: `$effect` at the top level of a module.

interface ModuleEffect {
  readInputs: () => unknown[];
  callback: () => unknown;
  /** Undefined until the first run. */
  inputs: unknown;
  hasRun: boolean;
  teardown: (() => void) | undefined;
}

interface ModuleMemo {
  readInputs: () => unknown[];
  update: () => unknown;
  /** The value it last computed. */
  value: unknown;
  inputs: unknown;
  sources: readonly Source[];
  writtenLater: boolean;
}

class ModuleEffects {
  private readonly effects: ModuleEffect[] = [];
  private readonly memos: ModuleMemo[] = [];

  addMemo(readInputs: () => unknown[], update: () => unknown, value: unknown): ModuleMemo {
    const sources = value instanceof Waiting ? value.sources : [];
    const inputs = deepCopy([...readInputs(), ...sources]);
    const memo = { readInputs, update, value, sources, inputs, writtenLater: false };
    this.memos.push(memo);
    return memo;
  }

  refreshMemos(): void {
    for (const memo of this.memos) {
      if (memo.writtenLater) continue;
      const values = memo.readInputs();
      const inputs = deepCopy([...values, ...memo.sources]);
      if (deepEqual(memo.inputs, inputs)) continue;
      const value = memo.update();
      noteReplacement(memo.value, value);
      memo.value = value;
      if (value instanceof Waiting) memo.sources = value.sources;
      memo.inputs = deepCopy([...values, ...memo.sources]);
    }
  }

  add(readInputs: () => unknown[], callback: () => unknown): void {
    this.effects.push({ readInputs, callback, inputs: undefined, hasRun: false, teardown: undefined });
  }

  /** Run module effects that are new or whose inputs changed. Returns whether any ran. */
  run(): boolean {
    let ran = false;
    for (const effect of this.effects) {
      const values = effect.readInputs();
      if ($waiting(values)) continue;
      const inputs = deepCopy(values);
      if (effect.hasRun && deepEqual(effect.inputs, inputs)) continue;

      effect.hasRun = true;
      effect.inputs = inputs;
      effect.teardown?.();
      effect.teardown = undefined;
      settleTeardown(effect.callback(), (teardown) => (effect.teardown = teardown));
      effect.inputs = deepCopy(effect.readInputs());
      ran = true;
    }
    return ran;
  }

  unmount(): void {
    for (const effect of this.effects) effect.teardown?.();
    this.effects.length = 0;
    this.memos.length = 0;
  }
}

/** Module effects registered since the last `renderApp`: the app being set up owns them. */
let unclaimedModuleEffects = new ModuleEffects();
let runningModuleEffects: ModuleEffects | undefined;

/** Own module work even if importing or mounting this case fails. */
export function beginReferenceScope(): () => void {
  computation = undefined;
  runningModuleEffects = undefined;
  rendering = null;
  externalReads.clear();
  const previous = unclaimedModuleEffects;
  const current = new ModuleEffects();
  unclaimedModuleEffects = current;
  return () => {
    current.unmount();
    unclaimedModuleEffects = previous;
  };
}

export function $moduleEffect(readInputs: () => unknown[], callback: () => unknown): void {
  unclaimedModuleEffects.add(readInputs, callback);
}

export function $moduleMemo(
  readInputs: () => unknown[],
  update: () => unknown,
  initial: unknown,
  read?: () => unknown,
  write?: (value: unknown) => void,
): { v: unknown } {
  const memo = (runningModuleEffects ?? unclaimedModuleEffects).addMemo(readInputs, update, initial);
  return {
    get v() {
      return read?.();
    },
    set v(value: unknown) {
      memo.writtenLater = true;
      noteReplacement(read?.(), value);
      write?.(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Deep copies: "an input changed" means its value changed, however deep.

/** Stands for any function: two functions compare equal. What they capture is read elsewhere. */
const FUNCTION = Symbol('function');

function hasOwnData(fn: Function): boolean {
  return Reflect.ownKeys(fn).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(fn, key)!;
    return descriptor.enumerable && 'value' in descriptor;
  });
}

function deepCopy(value: unknown, copies = new Map<object, unknown>()): unknown {
  const copy = (entry: unknown) => deepCopy(entry, copies);

  if (value instanceof Source) {
    return { source: value.id, version: value.version, data: copy(value.data) };
  }
  if (value instanceof Waiting) return { waiting: value.sources.map(copy) };

  // A function with data on it (a class with static fields) is copied like an object.
  if (typeof value === 'function' && !hasOwnData(value) && !privateVersions.has(value)) return FUNCTION;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (value instanceof Node || value instanceof AssignRef) return value;
  if (copies.has(value)) return copies.get(value);

  if (value instanceof Date) return { date: value.getTime() };

  if (value instanceof Map) {
    const entries: unknown[] = [];
    copies.set(value, entries);
    for (const [key, entry] of value) entries.push([copy(key), copy(entry)]);
    return { map: entries };
  }

  if (value instanceof Set) {
    const entries: unknown[] = [];
    copies.set(value, entries);
    for (const entry of value) entries.push(copy(entry));
    return { set: entries };
  }

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    copies.set(value, items);
    for (const item of value) items.push(copy(item));
    return items;
  }

  // Inspect data descriptors, never getter results. Reads belong to authored
  // code; taking a dependency snapshot must not execute an unused accessor.
  // Static fields are data on the constructor function; symbols and hidden
  // backing fields are data too, even though Object.entries omits them.
  const fields: unknown[] = [];
  const snapshot = { callable: typeof value === 'function', privateVersion: privateVersions.get(value), fields };
  copies.set(value, snapshot);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) continue;
    if (typeof value === 'function' && !descriptor.enumerable) continue;
    const field = descriptor.value;
    fields.push([key, copy(field)]);
  }
  return snapshot;
}

function deepEqual(left: unknown, right: unknown, visited = new Set<unknown>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (left instanceof Node || right instanceof Node) return false;
  if (visited.has(left)) return true;
  visited.add(left);

  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => deepEqual(
    (left as Record<string, unknown>)[key],
    (right as Record<string, unknown>)[key],
    visited,
  ));
}

// ---------------------------------------------------------------------------
// Rendering: DOM nodes kept by position

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** Written as DOM properties, as a user's input would set them. */
const PROPERTIES = new Set(['value', 'checked', 'selected']);

/** A host element the renderer created, and what it last set on it. */
interface HostRecord {
  kind: 'element';
  node: globalThis.Element;
  attributes: Map<string, string>;
  properties: Map<string, unknown>;
  handlers: Map<string, EventListener>;
  teardownRef: (() => void) | undefined;
  /** The last authored children; imperative DOM work survives an unchanged view. */
  children: Node[];
}

interface TextRecord {
  kind: 'text';
  node: Text;
}

type NodeRecord = HostRecord | TextRecord;

interface Policies {
  pending?: Component;
  error?: Component;
}

interface SuspendedBoundary {
  published: boolean;
  /** The failed attempt, shown with the error policy. */
  failed?: Waiting;
  /** Instances prepared by the failed attempt; retry discards them. */
  instances?: string[];
}

class Renderer {
  private nodes = new Map<string, NodeRecord>();
  private readonly instances = new Map<string, Instance>();
  private readonly componentTypes = new WeakMap<Component, number>();
  private nextComponentType = 0;
  private readonly moduleEffects: ModuleEffects;

  /** Filled during a render. */
  private renderedNodes = new Map<string, NodeRecord>();
  private renderedInstances = new Set<string>();
  private refsToInstall: Array<{ record: HostRecord; value: unknown }> = [];
  private readonly lastReady = new Map<string, unknown>();
  private renderedSites = new Set<string>();
  private readonly boundaries = new Map<string, SuspendedBoundary>();
  private renderedBoundaries = new Set<string>();
  private preparedInstances = new Set<string>();
  private preparedOutputs = new Map<string, unknown>();
  /** Setup/cleanup may write values rendered earlier, even while fallback DOM is unchanged. */
  private lifecycleChanged = false;

  constructor(
    private readonly root: Component,
    private readonly container: HTMLElement,
  ) {
    this.moduleEffects = unclaimedModuleEffects;
    unclaimedModuleEffects = new ModuleEffects();
  }

  /** Render, install refs and run effects, again and again until nothing changes. */
  update(): void {
    const outer = runningModuleEffects;
    runningModuleEffects = this.moduleEffects;
    for (let round = 0; round < 10; round++) {
      this.moduleEffects.refreshMemos();
      const before = this.container.innerHTML;
      const lifecycleChanged = this.renderOnce();
      const effectsRan = this.runEffects();
      if (!lifecycleChanged && !effectsRan && this.container.innerHTML === before) {
        runningModuleEffects = outer;
        return;
      }
    }
    runningModuleEffects = outer;
    throw new Error('reference: render did not settle after 10 passes');
  }

  unmount(): void {
    for (const record of this.nodes.values()) {
      if (record.kind === 'element') record.teardownRef?.();
    }
    for (const instance of this.instances.values()) instance.unmount();
    this.moduleEffects.unmount();
    this.nodes.clear();
    this.instances.clear();
    this.lastReady.clear();
    this.boundaries.clear();
    this.container.replaceChildren();
  }

  private renderOnce(): boolean {
    this.renderedNodes = new Map();
    this.renderedInstances = new Set();
    this.refsToInstall = [];
    this.renderedSites = new Set();
    this.renderedBoundaries = new Set();
    this.preparedInstances = new Set();
    this.preparedOutputs = new Map();
    this.lifecycleChanged = false;

    const children = this.renderNode($h(this.root, null), 'root', false);
    syncChildren(this.container, children);

    // Nodes and instances that were not rendered are gone.
    for (const [position, record] of this.nodes) {
      if (!this.renderedNodes.has(position) && record.kind === 'element' && record.teardownRef) {
        record.teardownRef();
        this.lifecycleChanged = true;
      }
    }
    for (const [id, instance] of this.instances) {
      if (this.renderedInstances.has(id) || this.preparedInstances.has(id)) continue;
      instance.unmount();
      this.instances.delete(id);
      this.lifecycleChanged = true;
    }
    this.nodes = this.renderedNodes;
    for (const position of this.lastReady.keys()) {
      if (!this.renderedSites.has(position)) this.lastReady.delete(position);
    }
    for (const position of this.boundaries.keys()) {
      if (!this.renderedBoundaries.has(position)) this.boundaries.delete(position);
    }

    // Refs are installed once the DOM exists.
    for (const { record, value } of this.refsToInstall) record.teardownRef = installRef(value, record.node);
    return this.refsToInstall.length > 0 || this.lifecycleChanged;
  }

  private runEffects(): boolean {
    let ran = false;
    for (const id of this.renderedInstances) ran = this.instances.get(id)!.runEffects() || ran;
    return this.moduleEffects.run() || ran;
  }

  // --- One render ------------------------------------------------------------

  /** The DOM nodes for one JSX value, at a position in the tree. */
  private renderNode(node: unknown, position: string, inSvg: boolean, policies: Policies = {}): Node[] {
    this.renderedSites.add(position);
    if (node instanceof Waiting) return this.renderWaiting(node, position, inSvg, policies);
    if (!isElement(node) || !$waiting(Object.values(node.props))) this.lastReady.set(position, node);
    if (node === null || node === undefined || typeof node === 'boolean') return [];

    if (Array.isArray(node)) return this.renderChildren(node, position, inSvg, policies);

    if (!isElement(node)) return [this.renderText(String(node), position)];

    position = elementPosition(node, position);
    if (node.props.suspend === true) return this.renderSuspended(node, position, inSvg, policies);
    return this.renderElement(node, position, inSvg, policies);
  }

  private renderElement(node: Element, position: string, inSvg: boolean, policies: Policies): Node[] {
    if (node.tag === Group) {
      return this.renderChildren(node.children, position, inSvg, this.groupPolicies(node, policies));
    }

    if (node.tag === Fragment) return this.renderChildren(node.children, position, inSvg, policies);

    if (typeof node.tag === 'function') return this.renderComponent(node, node.tag, position, inSvg, policies);

    const blocked = $waiting(Object.values(node.props));
    if (blocked) return this.renderWaiting(blocked, position, inSvg, policies);
    return [this.renderHostElement(node, node.tag, position, inSvg, policies)];
  }

  /**
   * `suspend` (`docs/06-group.md`): until the region first publishes, its active
   * subtree is prepared without DOM. It publishes all at once when nothing in it
   * waits, shows the error policy if something failed, and the pending policy
   * otherwise. After publishing it renders like any element.
   */
  private renderSuspended(node: Element, position: string, inSvg: boolean, policies: Policies): Node[] {
    this.renderedBoundaries.add(position);
    let boundary = this.boundaries.get(position);
    if (!boundary) {
      boundary = { published: false };
      this.boundaries.set(position, boundary);
    }
    const inherited = node.tag === Group ? this.groupPolicies(node, policies) : policies;
    if (boundary.published) return this.renderElement(node, position, inSvg, policies);

    // Prepared again on every render, with the instances of earlier attempts. A
    // child whose inputs did not change reuses its sources, so an unrelated render
    // sends no request and a failure stays. A child that now reads something else
    // (new props, a changed captured value) makes a new request: a new attempt.
    const preparation = new Preparation((element, component, path) => {
      const { id, output, instance } = this.evaluateComponent(element, component, path);
      return { id, output, waiting: instance.waitingEffects() };
    });
    preparation.element(node, position);
    for (const id of preparation.instances) this.preparedInstances.add(id);

    const waiting = preparation.waiting;
    if (waiting !== undefined && waiting.sources.some((source) => source.error)) {
      boundary.failed = waiting;
      boundary.instances = [...preparation.instances];
      return this.renderBoundaryFailure(boundary, position, inSvg, inherited);
    }
    boundary.failed = undefined;
    if (waiting !== undefined) return this.renderWaiting(waiting, position, inSvg, inherited, false);

    boundary.published = true;
    for (const [id, output] of preparation.outputs) this.preparedOutputs.set(id, output);
    return this.renderElement(node, position, inSvg, policies);
  }

  private renderBoundaryFailure(
    boundary: SuspendedBoundary,
    position: string,
    inSvg: boolean,
    policies: Policies,
  ): Node[] {
    const waiting = boundary.failed!;
    // Retry starts over: the failed attempt's instances (and the sources only they
    // own) are discarded, so child work is created again; failed sources owned
    // outside the region are refreshed.
    const retry = () => {
      for (const id of boundary.instances ?? []) {
        this.instances.get(id)?.unmount();
        this.instances.delete(id);
      }
      boundary.instances = undefined;
      boundary.failed = undefined;
      const failed = waiting.sources.filter((source) => source.error && !source.isDisposed);
      return Promise.all(failed.map((source) => source.refresh()));
    };
    return this.renderWaiting(waiting, position, inSvg, policies, false, retry);
  }

  private groupPolicies(node: Element, policies: Policies): Policies {
    return {
      pending: 'pending' in node.props ? node.props.pending as Component | undefined : policies.pending,
      error: 'error' in node.props ? node.props.error as Component | undefined : policies.error,
    };
  }

  /**
   * A site whose value is waiting shows, in order: the error policy if a source
   * failed; the last value it showed, when every source it waits for replaces a
   * loaded one (an input change is a refresh); the pending policy. A source that
   * never loaded is an initial load, even at a site that showed something else
   * before. `retain` is false inside a `suspend` region, which shows no partial
   * content before it publishes.
   */
  private renderWaiting(
    waiting: Waiting,
    position: string,
    inSvg: boolean,
    policies: Policies,
    retain = true,
    retryOverride?: () => unknown,
  ): Node[] {
    const failed = waiting.sources.filter((source) => source.error !== null);
    if (failed.length > 0) {
      if (!policies.error) return [];
      const cause = failed[0]!.error!;
      const error = {
        kind: 'request',
        requestKind: cause.kind,
        message: cause.message,
        status: cause.status,
        cause,
      };
      const retry = retryOverride ?? (() => Promise.all(failed.map((source) => source.refresh())));
      return this.renderNode($h(policies.error, { error, retry }), `${position}/error`, inSvg);
    }
    if (retain && waiting.replacing && this.lastReady.has(position)) {
      return this.renderNode(this.lastReady.get(position), position, inSvg, policies);
    }
    return policies.pending
      ? this.renderNode($h(policies.pending, null), `${position}/pending`, inSvg)
      : [];
  }

  private renderChildren(children: unknown[], position: string, inSvg: boolean, policies: Policies): Node[] {
    const occurrences = new Map<string, number>();
    return children.flatMap((child, index) => {
      return this.renderNode(child, childPosition(child, index, position, occurrences), inSvg, policies);
    });
  }

  private renderText(text: string, position: string): Node {
    const id = `${position}:text`;
    const previous = this.nodes.get(id);
    const record: TextRecord = previous?.kind === 'text' ? previous : { kind: 'text', node: document.createTextNode(text) };
    if (record.node.data !== text) record.node.data = text;
    this.renderedNodes.set(id, record);
    return record.node;
  }

  private renderComponent(node: Element, component: Component, position: string, inSvg: boolean, policies: Policies): Node[] {
    const id = this.componentId(node, component, position);
    const output = this.preparedOutputs.has(id)
      ? this.preparedOutputs.get(id)
      : this.evaluateComponent(node, component, position).output;
    this.renderedInstances.add(id);
    return this.renderNode(output, `${id}>`, inSvg, policies);
  }

  /** Call the component with its instance's slots. Used by rendering and by `suspend` preparation. */
  private evaluateComponent(
    node: Element,
    component: Component,
    position: string,
  ): { id: string; output: unknown; instance: Instance } {
    const id = this.componentId(node, component, position);
    let instance = this.instances.get(id);
    if (instance === undefined) {
      instance = new Instance();
      this.instances.set(id, instance);
      this.lifecycleChanged = true;
    }

    const props: Record<string, unknown> = { ...node.props };
    delete props.key;
    delete props.suspend;
    if (node.children.length === 1) props.children = node.children[0];
    if (node.children.length > 1) props.children = node.children;

    const outer = rendering;
    rendering = instance;
    const leaveSourceOwner = enterSourceOwner(instance.sources);
    instance.beginRender();
    const output = component(props);
    instance.finishSetup();
    leaveSourceOwner();
    rendering = outer;
    instance.first = false;

    return { id, output, instance };
  }

  private componentId(node: Element, component: Component, position: string): string {
    // Policy calls are synthesized by the renderer. Their closures are refreshed
    // with the parent's render; their established presentation slot stays put.
    if (node.site === undefined) return `${position}:${component.name}`;
    let type = this.componentTypes.get(component);
    if (type === undefined) {
      type = this.nextComponentType++;
      this.componentTypes.set(component, type);
    }
    return `${position}:${component.name}@${type}`;
  }

  private renderHostElement(node: Element, tag: string, position: string, inSvg: boolean, policies: Policies): Node {
    const svg = inSvg || tag === 'svg';
    const id = `${position}:<${tag}>`;
    const previous = this.nodes.get(id);

    let record: HostRecord;
    if (previous?.kind === 'element') {
      record = previous;
    } else {
      const element = svg ? document.createElementNS(SVG_NAMESPACE, tag) : document.createElement(tag);
      record = {
        kind: 'element',
        node: element,
        attributes: new Map(),
        properties: new Map(),
        handlers: new Map(),
        teardownRef: undefined,
        children: [],
      };
      if ('ref' in node.props) this.refsToInstall.push({ record, value: node.props.ref });
    }

    updateProps(record, node.props);
    const children = this.renderChildren(node.children, position, svg && tag !== 'foreignObject', policies);
    const childrenChanged = children.length !== record.children.length
      || children.some((child, index) => child !== record.children[index]);
    if (childrenChanged) {
      syncChildren(record.node, children);
      record.children = children;
    }

    this.renderedNodes.set(id, record);
    return record.node;
  }
}

/** Make `parent`'s children exactly `children`, in order, moving nodes that already exist. */
function syncChildren(parent: Node, children: Node[]): void {
  children.forEach((child, index) => {
    const current = parent.childNodes[index];
    if (current !== child) parent.insertBefore(child, current ?? null);
  });
  while (parent.childNodes.length > children.length) parent.lastChild!.remove();
}

function updateProps(record: HostRecord, props: Record<string, unknown>): void {
  const element = record.node;
  const attributes = new Map<string, string>();
  const handlers = new Map<string, EventListener>();

  for (const [name, value] of Object.entries(props)) {
    if (name === 'key' || name === 'ref' || name === 'children' || name === 'suspend') continue;

    if (name.startsWith('on')) {
      if (typeof value === 'function') handlers.set(name.slice(2).toLowerCase(), value as EventListener);
      continue;
    }

    if (PROPERTIES.has(name)) {
      // Written when the prop changes, so typed text stays until the state says otherwise.
      if (!record.properties.has(name) || !Object.is(record.properties.get(name), value)) {
        (element as unknown as Record<string, unknown>)[name] = value;
        record.properties.set(name, value);
      }
      continue;
    }

    if (value === null || value === undefined || value === false) continue;
    const attribute = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;
    attributes.set(attribute, value === true ? '' : String(value));
  }

  for (const name of record.attributes.keys()) {
    if (!attributes.has(name)) element.removeAttribute(name);
  }
  for (const [name, value] of attributes) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  record.attributes = attributes;

  // One listener per event name, calling whichever handler the latest render gave.
  for (const name of handlers.keys()) {
    if (!record.handlers.has(name)) {
      element.addEventListener(name, (event) => record.handlers.get(name)?.(event));
    }
  }
  record.handlers = handlers;
}

// ---------------------------------------------------------------------------
// The app

export interface ReferenceApp {
  container: HTMLElement;
  /** Render again from the current state, until nothing changes. */
  render(): void;
  unmount(): void;
}

export function renderApp(root: Component, container: HTMLElement): ReferenceApp {
  const renderer = new Renderer(root, container);
  renderer.update();
  return { container, render: () => renderer.update(), unmount: () => renderer.unmount() };
}
