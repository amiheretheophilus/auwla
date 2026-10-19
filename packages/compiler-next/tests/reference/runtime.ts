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
import { $waiting, Group, Source, Waiting } from './sources';
export { $fetch, $read, $track, $value, $waiting, $when, $sourceState, Group } from './sources';

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

function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && 'tag' in value && 'props' in value && 'children' in value;
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

class CellSlot {
  private value: unknown;
  initialized = false;
  written = false;

  get v(): unknown { return this.value; }
  set v(value: unknown) {
    this.value = value;
    this.written = true;
  }

  seed(value: unknown): void {
    this.value = value;
    this.initialized = !(value instanceof Waiting);
  }
}

interface PropSlot {
  v: unknown;
  /** The last value the parent passed. */
  fromParent: unknown;
}

interface MemoSlot {
  v: unknown;
  /** True on the render where the value was computed again. */
  fresh: boolean;
  /** Deep copy of the inputs it was computed from. */
  inputs: unknown;
  /** Sources discovered when a helper returned a waiting computation. */
  sources: readonly Source[];
}

interface EffectSlot {
  inputs: unknown;
  teardown: (() => void) | undefined;
  readInputs: () => unknown[];
  callback: () => unknown;
  hasRun: boolean;
}

export class Instance {
  /** True during the instance's first render. */
  first = true;
  /** How many times the instance has rendered. A memo that reads it is computed on every render. */
  render = 0;
  private readonly slots = new Map<number, CellSlot | PropSlot | MemoSlot>();
  private readonly effects = new Map<number, EffectSlot>();
  /** Effects called during the current render; the others are destroyed. */
  private readonly calledEffects = new Set<number>();
  private readonly cleanups: Array<() => void> = [];
  /** `"statement:position"` pairs from `observe`: that statement changed that value. */
  private readonly confirmations = new Set<string>();
  private readonly statementsRun = new Set<number>();

  /** State: computed once, then changed only by writes. */
  cell(index: number, initial: () => unknown): CellSlot {
    let slot = this.slots.get(index) as CellSlot | undefined;
    if (slot === undefined) {
      slot = new CellSlot();
      this.slots.set(index, slot);
    }
    if (!slot.initialized && !slot.written) slot.seed(initial());
    return slot;
  }

  /** A prop the component reassigns: the override holds until the parent passes a different value. */
  prop(index: number, fromParent: unknown): PropSlot {
    let slot = this.slots.get(index) as PropSlot | undefined;
    if (slot === undefined) {
      slot = { v: fromParent, fromParent };
      this.slots.set(index, slot);
    } else if (!Object.is(slot.fromParent, fromParent)) {
      slot.v = fromParent;
      slot.fromParent = fromParent;
    }
    return slot;
  }

  /** A derived value: computed again only when one of its inputs changes. */
  memo(index: number, readInputs: () => unknown[], compute: () => unknown): MemoSlot {
    let slot = this.slots.get(index) as MemoSlot | undefined;
    const values = readInputs();
    const inputs = deepCopy([...values, ...(slot?.sources ?? [])]);

    if (slot === undefined) {
      const value = compute();
      const sources = value instanceof Waiting ? value.sources : [];
      slot = { v: value, fresh: true, inputs: deepCopy([...values, ...sources]), sources };
      this.slots.set(index, slot);
    } else if (!deepEqual(slot.inputs, inputs)) {
      // Updated in place, because handlers from earlier renders hold this slot.
      slot.v = compute();
      slot.fresh = true;
      if (slot.v instanceof Waiting) slot.sources = slot.v.sources;
      slot.inputs = deepCopy([...values, ...slot.sources]);
    } else {
      slot.fresh = false;
    }
    return slot;
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
    readValues().forEach((value, position) => {
      if (!deepEqual(before[position], deepCopy(value))) this.confirmations.add(`${index}:${position}`);
    });
  }

  /** Whether statement `index` was seen to change the value at `position`. */
  confirmed(index: number, position: number): boolean {
    return this.confirmations.has(`${index}:${position}`);
  }

  ran(index: number): boolean {
    return this.statementsRun.has(index);
  }

  statement(index: number, readInputs: () => unknown[], run: () => void): void {
    if ($waiting(readInputs())) return;
    run();
    this.statementsRun.add(index);
  }

  /** Called before each render of the instance. */
  beginRender(): void {
    this.render++;
    this.calledEffects.clear();
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
      const values = slot.readInputs();
      if ($waiting(values)) continue;
      const inputs = deepCopy(values);
      if (slot.hasRun && deepEqual(slot.inputs, inputs)) continue;
      slot.hasRun = true;
      slot.teardown?.();
      slot.teardown = undefined;
      settleTeardown(slot.callback(), (teardown) => (slot.teardown = teardown));
      // The effect already saw its own synchronous writes. They update the UI,
      // but do not immediately re-trigger this effect.
      slot.inputs = deepCopy(slot.readInputs());
      ran = true;
    }
    return ran;
  }

  unmount(): void {
    for (const slot of this.effects.values()) slot.teardown?.();
    this.effects.clear();
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.cleanups.length = 0;
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
  inputs: unknown;
  sources: readonly Source[];
}

class ModuleEffects {
  private readonly effects: ModuleEffect[] = [];
  private readonly memos: ModuleMemo[] = [];

  addMemo(readInputs: () => unknown[], update: () => unknown, value: unknown): void {
    const sources = value instanceof Waiting ? value.sources : [];
    this.memos.push({ readInputs, update, sources, inputs: deepCopy([...readInputs(), ...sources]) });
  }

  refreshMemos(): void {
    for (const memo of this.memos) {
      const values = memo.readInputs();
      const inputs = deepCopy([...values, ...memo.sources]);
      if (deepEqual(memo.inputs, inputs)) continue;
      const value = memo.update();
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

/** Own module work even if importing or mounting this case fails. */
export function beginReferenceScope(): () => void {
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

export function $moduleMemo(readInputs: () => unknown[], update: () => unknown, initial: unknown): void {
  unclaimedModuleEffects.addMemo(readInputs, update, initial);
}

// ---------------------------------------------------------------------------
// Deep copies: "an input changed" means its value changed, however deep.

/** Stands for any function: functions are compared through what they capture. */
const FUNCTION = Symbol('function');

function deepCopy(value: unknown, copies = new Map<object, unknown>()): unknown {
  if (value instanceof Source) {
    return { source: value.id, version: value.version, data: deepCopy(value.data, copies) };
  }
  if (value instanceof Waiting) return { waiting: value.sources.map((source) => deepCopy(source, copies)) };
  if (typeof value === 'function') return FUNCTION;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Node || value instanceof AssignRef) return value;
  if (copies.has(value)) return copies.get(value);

  if (value instanceof Date) return { date: value.getTime() };

  if (value instanceof Map) {
    const entries: unknown[] = [];
    copies.set(value, entries);
    for (const [key, entry] of value) entries.push([deepCopy(key, copies), deepCopy(entry, copies)]);
    return { map: entries };
  }

  if (value instanceof Set) {
    const entries: unknown[] = [];
    copies.set(value, entries);
    for (const entry of value) entries.push(deepCopy(entry, copies));
    return { set: entries };
  }

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    copies.set(value, items);
    for (const item of value) items.push(deepCopy(item, copies));
    return items;
  }

  const fields: Record<string, unknown> = {};
  copies.set(value, fields);
  for (const [key, field] of Object.entries(value)) fields[key] = deepCopy(field, copies);
  return fields;
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

class Renderer {
  private nodes = new Map<string, NodeRecord>();
  private readonly instances = new Map<string, Instance>();
  private readonly moduleEffects: ModuleEffects;

  /** Filled during a render. */
  private renderedNodes = new Map<string, NodeRecord>();
  private renderedInstances = new Set<string>();
  private refsToInstall: Array<{ record: HostRecord; value: unknown }> = [];
  private readonly lastReady = new Map<string, unknown>();
  private renderedSites = new Set<string>();

  constructor(
    private readonly root: Component,
    private readonly container: HTMLElement,
  ) {
    this.moduleEffects = unclaimedModuleEffects;
    unclaimedModuleEffects = new ModuleEffects();
  }

  /** Render, install refs and run effects, again and again until nothing changes. */
  update(): void {
    for (let round = 0; round < 10; round++) {
      this.moduleEffects.refreshMemos();
      const before = this.container.innerHTML;
      const refsInstalled = this.renderOnce();
      const effectsRan = this.runEffects();
      if (!refsInstalled && !effectsRan && this.container.innerHTML === before) return;
    }
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
    this.container.replaceChildren();
  }

  private renderOnce(): boolean {
    this.renderedNodes = new Map();
    this.renderedInstances = new Set();
    this.refsToInstall = [];
    this.renderedSites = new Set();

    const children = this.renderNode($h(this.root, null), 'root', false);
    syncChildren(this.container, children);

    // Nodes and instances that were not rendered are gone.
    for (const [position, record] of this.nodes) {
      if (!this.renderedNodes.has(position) && record.kind === 'element') record.teardownRef?.();
    }
    for (const [id, instance] of this.instances) {
      if (this.renderedInstances.has(id)) continue;
      instance.unmount();
      this.instances.delete(id);
    }
    this.nodes = this.renderedNodes;
    for (const position of this.lastReady.keys()) {
      if (!this.renderedSites.has(position)) this.lastReady.delete(position);
    }

    // Refs are installed once the DOM exists.
    for (const { record, value } of this.refsToInstall) record.teardownRef = installRef(value, record.node);
    return this.refsToInstall.length > 0;
  }

  private runEffects(): boolean {
    let ran = false;
    for (const instance of this.instances.values()) ran = instance.runEffects() || ran;
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

    if (node.site !== undefined) position += `/site=${String(node.site)}`;

    if (node.props.suspend === true) {
      throw new Error('reference: suspend preparation is not implemented yet');
    }

    // A key also matters when a component returns a keyed root directly.
    if (node.props.key !== undefined && node.props.key !== null) position += `/key=${String(node.props.key)}`;

    if (node.tag === Group) {
      const inherited = { ...policies };
      if ('pending' in node.props) inherited.pending = node.props.pending as Component | undefined;
      if ('error' in node.props) inherited.error = node.props.error as Component | undefined;
      return this.renderChildren(node.children, position, inSvg, inherited);
    }

    if (node.tag === Fragment) return this.renderChildren(node.children, position, inSvg, policies);

    if (typeof node.tag === 'function') return this.renderComponent(node, node.tag, position, inSvg, policies);

    const blocked = $waiting(Object.values(node.props));
    if (blocked) return this.renderWaiting(blocked, position, inSvg, policies);
    return [this.renderHostElement(node, node.tag, position, inSvg, policies)];
  }

  private renderWaiting(waiting: Waiting, position: string, inSvg: boolean, policies: Policies): Node[] {
    const failed = waiting.sources.filter((source) => source.error !== null);
    if (failed.length > 0) {
      if (!policies.error) return [];
      const cause = failed[0]!.error!;
      const error = { kind: 'request', requestKind: cause.kind, message: cause.message, status: cause.status, cause };
      const retry = () => Promise.all(failed.map((source) => source.refresh()));
      return this.renderNode($h(policies.error, { error, retry }), `${position}/error`, inSvg);
    }
    if (this.lastReady.has(position)) {
      return this.renderNode(this.lastReady.get(position), position, inSvg, policies);
    }
    return policies.pending
      ? this.renderNode($h(policies.pending, null), `${position}/pending`, inSvg)
      : [];
  }

  private renderChildren(children: unknown[], position: string, inSvg: boolean, policies: Policies): Node[] {
    return children.flatMap((child, index) => {
      const key = isElement(child) ? child.props.key : undefined;
      const segment = key === undefined || key === null ? `#${index}` : `key=${String(key)}`;
      return this.renderNode(child, `${position}/${segment}`, inSvg, policies);
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
    const id = `${position}:${component.name}`;
    let instance = this.instances.get(id);
    if (instance === undefined) {
      instance = new Instance();
      this.instances.set(id, instance);
    }
    this.renderedInstances.add(id);

    const props: Record<string, unknown> = { ...node.props };
    delete props.key;
    if (node.children.length === 1) props.children = node.children[0];
    if (node.children.length > 1) props.children = node.children;

    const outer = rendering;
    rendering = instance;
    instance.beginRender();
    const output = component(props);
    rendering = outer;
    instance.first = false;

    return this.renderNode(output, `${id}>`, inSvg, policies);
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
    if (name === 'key' || name === 'ref' || name === 'children') continue;

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
