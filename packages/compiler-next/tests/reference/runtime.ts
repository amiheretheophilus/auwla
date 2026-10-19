/**
 * Runtime of the reference renderer (wiki/compiler/testing.md). Test-only.
 *
 * This is not how the framework renders. It is the slowest renderer that is
 * still obviously correct, so compiled output can be checked against it:
 *
 * - every render calls every component again and builds a brand-new DOM tree;
 * - nothing is diffed or patched: the old tree is thrown away;
 * - JSX produces plain `{ tag, props, children }` objects first, only so that each
 *   component call can be matched to the same instance as last time (by its
 *   position and `key`). That is how state survives a render.
 *
 * Values that must outlive one render live in slots of the component instance.
 * `transform.ts` decides which bindings need a slot.
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

export class Instance {
  /** True during the instance's first render. */
  first = true;
  private readonly slots = new Map<number, CellSlot | PropSlot | MemoSlot>();

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

  /** A derived value that code may mutate: kept until one of its inputs changes. */
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
}

let rendering: Instance | null = null;

/** Called first in every transformed component: the instance being rendered. */
export function $enter(): Instance {
  if (rendering === null) throw new Error('reference: a component was called outside a render');
  return rendering;
}

// ---------------------------------------------------------------------------
// Deep copies: "an input changed" means its value changed, however deep.

/** Stands for any function: functions are compared through what they capture. */
const FUNCTION = Symbol('function');

function deepCopy(value: unknown, copies = new Map<object, unknown>()): unknown {
  if (typeof value === 'function') return FUNCTION;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Node) return value;
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
// Rendering a tree

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** Written as DOM properties, as a user's input would set them. */
const PROPERTIES = new Set(['value', 'checked', 'selected']);

interface Render {
  /** Every instance alive after the previous render, by its position. */
  instances: Map<string, Instance>;
  /** Positions rendered this time. The others are unmounted. */
  rendered: Set<string>;
}

function renderNode(parent: Node, node: unknown, position: string, render: Render, inSvg: boolean): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;

  if (Array.isArray(node)) {
    renderChildren(parent, node, position, render, inSvg);
    return;
  }

  if (!isElement(node)) {
    parent.appendChild(document.createTextNode(String(node)));
    return;
  }

  if (node.tag === Fragment) {
    renderChildren(parent, node.children, position, render, inSvg);
    return;
  }

  if (typeof node.tag === 'function') {
    renderComponent(parent, node, node.tag, position, render, inSvg);
    return;
  }

  renderHostElement(parent, node, node.tag, position, render, inSvg);
}

function renderChildren(parent: Node, children: unknown[], position: string, render: Render, inSvg: boolean): void {
  children.forEach((child, index) => {
    const key = isElement(child) ? child.props.key : undefined;
    const segment = key === undefined || key === null ? `#${index}` : `key=${String(key)}`;
    renderNode(parent, child, `${position}/${segment}`, render, inSvg);
  });
}

function renderComponent(parent: Node, node: Element, component: Component, position: string, render: Render, inSvg: boolean): void {
  const id = `${position}:${component.name}`;
  let instance = render.instances.get(id);
  if (instance === undefined) {
    instance = new Instance();
    render.instances.set(id, instance);
  }
  render.rendered.add(id);

  const props: Record<string, unknown> = { ...node.props };
  delete props.key;
  if (node.children.length === 1) props.children = node.children[0];
  if (node.children.length > 1) props.children = node.children;

  const outer = rendering;
  rendering = instance;
  const output = component(props);
  rendering = outer;
  instance.first = false;

  renderNode(parent, output, `${id}>`, render, inSvg);
}

function renderHostElement(parent: Node, node: Element, tag: string, position: string, render: Render, inSvg: boolean): void {
  const svg = inSvg || tag === 'svg';
  const element = svg ? document.createElementNS(SVG_NAMESPACE, tag) : document.createElement(tag);
  for (const [name, value] of Object.entries(node.props)) setProp(element, name, value);
  renderChildren(element, node.children, position, render, svg && tag !== 'foreignObject');
  parent.appendChild(element);
}

function setProp(element: globalThis.Element, name: string, value: unknown): void {
  if (name === 'key' || name === 'ref' || name === 'children') return;

  if (name.startsWith('on')) {
    if (typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    return;
  }

  if (PROPERTIES.has(name)) {
    (element as unknown as Record<string, unknown>)[name] = value;
    return;
  }

  if (value === null || value === undefined || value === false) return;
  const attribute = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;
  element.setAttribute(attribute, value === true ? '' : String(value));
}

// ---------------------------------------------------------------------------
// The app

export interface ReferenceApp {
  container: HTMLElement;
  /** Render the whole tree again from the current state. */
  render(): void;
}

export function renderApp(root: Component, container: HTMLElement): ReferenceApp {
  const instances = new Map<string, Instance>();

  const render = () => {
    const pass: Render = { instances, rendered: new Set() };
    const fragment = document.createDocumentFragment();
    renderNode(fragment, $h(root, null), 'root', pass, false);

    // An instance that was not rendered is unmounted; rendering it again starts fresh.
    for (const id of instances.keys()) {
      if (!pass.rendered.has(id)) instances.delete(id);
    }
    container.replaceChildren(fragment);
  };

  render();
  return { container, render };
}
