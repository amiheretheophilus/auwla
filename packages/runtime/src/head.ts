/**
 * `<head>` in a component: its title, meta and link tags go into the document's head while the
 * component is on the page (`wiki/compiler/head.md`).
 *
 * The compiler turns `<head>…</head>` into `headValue(<>…</>)`, a value its site shows like any
 * other. Showing it puts nothing where it is written: the tags are built, and kept up to date by
 * their own bindings, in a holder off the page. After each block mounts, updates or goes away, the
 * page's head is worked out again:
 *
 * - tags are keyed: `title`, `meta[name]`, `meta[property]`, `link[rel=canonical]`. For each key
 *   the block of the deepest component wins, and of two at one depth the later one, so a page's
 *   title replaces its layout's;
 * - other tags (`meta[charset]`, a stylesheet link) all show;
 * - what `index.html` has for a key is set aside while a block sets that key, and comes back
 *   when none does.
 *
 * In a browser the winners are copied into `document.head`, marked `data-mmd-head`. On a server
 * nothing is copied: the render's winners are read once (`serverPageHead`) and written into the
 * page's head by `@memoized-dom/server`, which keeps the template's overridden tags in a
 * `<template data-mmd-head-original>` so the browser can bring them back.
 */
import { getActiveApplicationRuntime, getExtensionStore } from './kernel';
import { getActiveEnvironment } from './kernel';
import { childSlot, createRenderValue, disposeSlot, type RenderOwner, type RenderProgram, type ValueSlot } from './render-value';

/** One mounted `<head>` block. */
interface Block {
  readonly holder: Element;
  readonly depth: number;
  readonly order: number;
}

interface HeadStore {
  readonly blocks: Set<Block>;
  order: number;
  /** Browser: the copy shown for each key, and for each unkeyed tag by the tag it copies. */
  readonly copies: Map<string | Element, Element>;
  /** Browser: `index.html`'s tag for each key, read the first time a block mounts. */
  originals: Map<string, Element> | null;
  /** Browser: where each original was while a block covers it, so it comes back to its place. */
  readonly places: Map<string, Comment>;
}

const MARK = 'data-mmd-head';
const ORIGINAL = 'data-mmd-head-original';

function store(): HeadStore {
  return getExtensionStore('mmd:head', () => ({
    blocks: new Set(), order: 0, copies: new Map(), originals: null, places: new Map(),
  }));
}

const HEAD_PROGRAM: RenderProgram = {
  mount(values, owner) {
    const document = getActiveEnvironment().document;
    const holder = document.createElement('head');
    const anchor = document.createTextNode('');
    holder.appendChild(anchor);
    let slot: ValueSlot | null = null;
    const show = (value: unknown) => {
      (slot = childSlot(slot, anchor, value, owner, false))?.write(value);
    };
    show(values[0]);
    const state = store();
    const block: Block = { holder, depth: depthOf(owner), order: ++state.order };
    state.blocks.add(block);
    reconcile(state);
    return {
      nodes: [],
      update(next) {
        show(next[0]);
        reconcile(state);
      },
      dispose() {
        slot = disposeSlot(slot);
        state.blocks.delete(block);
        reconcile(state);
      },
    };
  },
};

/** What `<head>…</head>` in markup compiles to. */
export function headValue(children: unknown): object {
  return createRenderValue(HEAD_PROGRAM, [children]);
}

function depthOf(owner: RenderOwner): number {
  return owner.entity?.depth ?? 0;
}

/** A tag's key, or null when every such tag shows. */
function keyOf(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  if (tag === 'title') return 'title';
  if (tag === 'meta') {
    const name = element.getAttribute('name');
    if (name !== null) return `meta:name:${name}`;
    const property = element.getAttribute('property');
    if (property !== null) return `meta:property:${property}`;
    return null;
  }
  if (tag === 'link' && element.getAttribute('rel') === 'canonical') return 'link:canonical';
  return null;
}

/** The tags to show, in order: winners by key, then every unkeyed tag. */
function chosen(state: HeadStore): { readonly keyed: Map<string, Element>; readonly unkeyed: Element[] } {
  const keyed = new Map<string, Element>();
  const unkeyed: Element[] = [];
  const blocks = [...state.blocks].sort((left, right) => left.depth - right.depth || left.order - right.order);
  for (const block of blocks) {
    for (const element of elementsOf(block.holder)) {
      const key = keyOf(element);
      if (key === null) unkeyed.push(element);
      else keyed.set(key, element);
    }
  }
  return { keyed, unkeyed };
}

function elementsOf(parent: Node): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function reconcile(state: HeadStore): void {
  const document = getActiveEnvironment().document as Document;
  // A server's document has no head: its render's tags are read at the end (`serverPageHead`).
  const head = (document as { head?: HTMLHeadElement | null }).head;
  if (head == null) return;
  state.originals ??= readOriginals(head);
  const { keyed, unkeyed } = chosen(state);

  const shown = new Set<string | Element>();
  for (const [key, source] of keyed) {
    shown.add(key);
    show(state, head, key, source);
    const original = state.originals.get(key);
    if (original?.parentNode === head) {
      const place = head.ownerDocument.createComment(`mmd-head ${key}`);
      head.insertBefore(place, original);
      head.removeChild(original);
      state.places.set(key, place);
    }
  }
  for (const source of unkeyed) {
    shown.add(source);
    show(state, head, source, source);
  }
  for (const [id, copy] of state.copies) {
    if (shown.has(id)) continue;
    copy.remove();
    state.copies.delete(id);
    if (typeof id === 'string') restore(state, head, id);
  }
  // With no block left, everything is back: the next block reads the head afresh, as it is then
  // (after hot replacement, or another app mounted in this runtime).
  if (state.blocks.size === 0) state.originals = null;
}

/** Put `index.html`'s tag for `key` back where it was, or at the end of the head. */
function restore(state: HeadStore, head: HTMLHeadElement, key: string): void {
  const original = state.originals?.get(key);
  const place = state.places.get(key);
  state.places.delete(key);
  if (original === undefined || original.parentNode === head) return;
  if (place?.parentNode === head) {
    head.insertBefore(original, place);
    head.removeChild(place);
  } else {
    head.appendChild(original);
  }
}

/** Show `source` in `head` as the copy kept under `id`, made or brought up to date. */
function show(state: HeadStore, head: HTMLHeadElement, id: string | Element, source: Element): void {
  let copy = state.copies.get(id);
  if (copy === undefined || copy.tagName !== source.tagName) {
    copy?.remove();
    copy = head.ownerDocument.createElement(source.tagName.toLowerCase());
    state.copies.set(id, copy);
  }
  for (const { name } of Array.from(copy.attributes)) {
    if (name !== MARK && !source.hasAttribute(name)) copy.removeAttribute(name);
  }
  for (const [name, value] of attributesOf(source)) {
    if (copy.getAttribute(name) !== value) copy.setAttribute(name, value);
  }
  copy.setAttribute(MARK, '');
  const text = source.textContent ?? '';
  if (copy.textContent !== text) copy.textContent = text;
  if (copy.parentNode !== head) head.appendChild(copy);
}

/**
 * `index.html`'s keyed tags, as it was before any block: in the head, or kept by the server in a
 * `<template data-mmd-head-original>` because the page it rendered overrode them. The tags the
 * server wrote for its render are dropped: the blocks show their own.
 */
function readOriginals(head: HTMLHeadElement): Map<string, Element> {
  const originals = new Map<string, Element>();
  for (const element of elementsOf(head)) {
    if (element.hasAttribute(MARK)) {
      element.remove();
      continue;
    }
    if (element.tagName === 'TEMPLATE' && element.hasAttribute(ORIGINAL)) {
      for (const kept of elementsOf((element as HTMLTemplateElement).content)) {
        const key = keyOf(kept);
        if (key !== null) originals.set(key, head.ownerDocument.importNode(kept, true) as Element);
      }
      element.remove();
      continue;
    }
    const key = keyOf(element);
    if (key !== null && !originals.has(key)) originals.set(key, element);
  }
  return originals;
}

/** One tag the server writes into the page's head, and the key it replaces the template's for. */
export interface ServerHeadTag {
  readonly key: string | null;
  readonly html: string;
}

/**
 * The tags this render's blocks show, for the server to write into the page's head. Call it inside
 * the render's application runtime, after the first render.
 */
export function serverPageHead(): readonly ServerHeadTag[] {
  const state = getActiveApplicationRuntime().state.extensions.get('mmd:head') as HeadStore | undefined;
  if (state === undefined) return [];
  const { keyed, unkeyed } = chosen(state);
  return [
    ...[...keyed].map(([key, element]) => ({ key, html: tagHtml(element) })),
    ...unkeyed.map((element) => ({ key: null, html: tagHtml(element) })),
  ];
}

/** A head tag as HTML, marked as the render's. Head tags hold text only. */
function tagHtml(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const attributes = [...attributesOf(element), [MARK, ''] as const]
    .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`))
    .join('');
  if (tag === 'meta' || tag === 'link' || tag === 'base') return `<${tag}${attributes}>`;
  return `<${tag}${attributes}>${escapeText(element.textContent ?? '')}</${tag}>`;
}

/** A browser element's attributes, or the server's string element's (a Map). */
function attributesOf(element: Element): [string, string][] {
  const attributes = (element as { attributes: unknown }).attributes;
  if (attributes instanceof Map) return [...(attributes as Map<string, string>)];
  return Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]);
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}
