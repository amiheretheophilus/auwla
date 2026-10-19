/**
 * Runtime of the reference renderer (wiki/compiler/testing.md). Test-only.
 *
 * This is not how the framework renders. It is the simplest renderer that is
 * still correct, so compiled output can be checked against it:
 *
 * - every render calls every component again. The component body is setup code:
 *   `transform.ts` makes everything except derivations run on the first render only;
 * - DOM nodes are kept between renders, matched by position, `key` and tag, so refs,
 *   typed text and focus survive. Each render updates their props and order;
 * - after the DOM is updated, refs are installed and effects run. If that changed
 *   anything, the app renders again, until nothing changes.
 *
 * Values that must outlive one render live in slots of the component instance.
 */

// ---------------------------------------------------------------------------
// JSX

export interface Element {
  tag: string | typeof Fragment | Component;
  props: Record<string, unknown>;
  children: unknown[];
}

export type Component = (props: Record<string, unknown>) => unknown;

export const Fragment = Symbol('Fragment');

/** The JSX factory of transformed modules. */
export function $h(tag: Element['tag'], props: Record<string, unknown> | null, ...children: unknown[]): Element {
  return { tag, props: props ?? {}, children };
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

interface CellSlot {
  v: unknown;
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
}

interface EffectSlot {
  inputs: unknown;
  teardown: (() => void) | undefined;
  /** Set during a render when the effect must run in the next commit. */
  pending: (() => unknown) | undefined;
}

export class Instance {
  /** True during the instance's first render. */
  first = true;
  private readonly slots = new Map<number, CellSlot | PropSlot | MemoSlot>();
  private readonly effects = new Map<number, EffectSlot>();
  /** Effects called during the current render; the others are destroyed. */
  private readonly calledEffects = new Set<number>();
  private readonly cleanups: Array<() => void> = [];

  /** State: computed once, then changed only by writes. */
  cell(index: number, initial: () => unknown): CellSlot {
    let slot = this.slots.get(index) as CellSlot | undefined;
    if (slot === undefined) {
      slot = { v: initial() };
      this.slots.set(index, slot);
    }
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
    const inputs = deepCopy(readInputs());
    let slot = this.slots.get(index) as MemoSlot | undefined;

    if (slot === undefined) {
      slot = { v: compute(), fresh: true, inputs };
      this.slots.set(index, slot);
    } else if (!deepEqual(slot.inputs, inputs)) {
      // Updated in place, because handlers from earlier renders hold this slot.
      slot.v = compute();
      slot.fresh = true;
      slot.inputs = inputs;
    } else {
      slot.fresh = false;
    }
    return slot;
  }

  /** `$effect(callback)`: runs after the commit when it is new or its inputs changed. */
  effect(index: number, readInputs: () => unknown[], callback: () => unknown): void {
    this.calledEffects.add(index);
    const inputs = deepCopy(readInputs());
    const slot = this.effects.get(index);

    if (slot === undefined) {
      this.effects.set(index, { inputs, teardown: undefined, pending: callback });
    } else if (!deepEqual(slot.inputs, inputs)) {
      slot.inputs = inputs;
      slot.pending = callback;
    }
  }

  /** `$cleanup(fn)`: runs once, when the instance is unmounted. */
  cleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /** Called before each render of the instance. */
  beginRender(): void {
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
        continue;
      }
      if (slot.pending === undefined) continue;
      const callback = slot.pending;
      slot.pending = undefined;
      slot.teardown?.();
      slot.teardown = undefined;
      settleTeardown(callback(), (teardown) => (slot.teardown = teardown));
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

class ModuleEffects {
  private readonly effects: ModuleEffect[] = [];

  add(readInputs: () => unknown[], callback: () => unknown): void {
    this.effects.push({ readInputs, callback, inputs: undefined, hasRun: false, teardown: undefined });
  }

  /** Run module effects that are new or whose inputs changed. Returns whether any ran. */
  run(): boolean {
    let ran = false;
    for (const effect of this.effects) {
      const inputs = deepCopy(effect.readInputs());
      if (effect.hasRun && deepEqual(effect.inputs, inputs)) continue;

      effect.hasRun = true;
      effect.inputs = inputs;
      effect.teardown?.();
      effect.teardown = undefined;
      settleTeardown(effect.callback(), (teardown) => (effect.teardown = teardown));
      ran = true;
    }
    return ran;
  }
}

/** Module effects registered since the last `renderApp`: the app being set up owns them. */
let unclaimedModuleEffects = new ModuleEffects();

export function $moduleEffect(readInputs: () => unknown[], callback: () => unknown): void {
  unclaimedModuleEffects.add(readInputs, callback);
}

// ---------------------------------------------------------------------------
// Deep copies: "an input changed" means its value changed, however deep.

/** Stands for any function: functions are compared through what they capture. */
const FUNCTION = Symbol('function');

function deepCopy(value: unknown, copies = new Map<object, unknown>()): unknown {
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
}

interface TextRecord {
  kind: 'text';
  node: Text;
}

type NodeRecord = HostRecord | TextRecord;

class Renderer {
  private nodes = new Map<string, NodeRecord>();
  private readonly instances = new Map<string, Instance>();
  private readonly moduleEffects: ModuleEffects;

  /** Filled during a render. */
  private renderedNodes = new Map<string, NodeRecord>();
  private renderedInstances = new Set<string>();
  private refsToInstall: Array<{ record: HostRecord; value: unknown }> = [];

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
      const before = this.container.innerHTML;
      const refsInstalled = this.renderOnce();
      const effectsRan = this.runEffects();
      if (!refsInstalled && !effectsRan && this.container.innerHTML === before) return;
    }
  }

  private renderOnce(): boolean {
    this.renderedNodes = new Map();
    this.renderedInstances = new Set();
    this.refsToInstall = [];

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
  private renderNode(node: unknown, position: string, inSvg: boolean): Node[] {
    if (node === null || node === undefined || typeof node === 'boolean') return [];

    if (Array.isArray(node)) return this.renderChildren(node, position, inSvg);

    if (!isElement(node)) return [this.renderText(String(node), position)];

    if (node.tag === Fragment) return this.renderChildren(node.children, position, inSvg);

    if (typeof node.tag === 'function') return this.renderComponent(node, node.tag, position, inSvg);

    return [this.renderHostElement(node, node.tag, position, inSvg)];
  }

  private renderChildren(children: unknown[], position: string, inSvg: boolean): Node[] {
    return children.flatMap((child, index) => {
      const key = isElement(child) ? child.props.key : undefined;
      const segment = key === undefined || key === null ? `#${index}` : `key=${String(key)}`;
      return this.renderNode(child, `${position}/${segment}`, inSvg);
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

  private renderComponent(node: Element, component: Component, position: string, inSvg: boolean): Node[] {
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

    return this.renderNode(output, `${id}>`, inSvg);
  }

  private renderHostElement(node: Element, tag: string, position: string, inSvg: boolean): Node {
    const svg = inSvg || tag === 'svg';
    const id = `${position}:<${tag}>`;
    const previous = this.nodes.get(id);

    let record: HostRecord;
    if (previous?.kind === 'element') {
      record = previous;
    } else {
      const element = svg ? document.createElementNS(SVG_NAMESPACE, tag) : document.createElement(tag);
      record = { kind: 'element', node: element, attributes: new Map(), properties: new Map(), handlers: new Map(), teardownRef: undefined };
      if ('ref' in node.props) this.refsToInstall.push({ record, value: node.props.ref });
    }

    updateProps(record, node.props);
    const children = this.renderChildren(node.children, position, svg && tag !== 'foreignObject');
    syncChildren(record.node, children);

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
}

export function renderApp(root: Component, container: HTMLElement): ReferenceApp {
  const renderer = new Renderer(root, container);
  renderer.update();
  return { container, render: () => renderer.update() };
}
