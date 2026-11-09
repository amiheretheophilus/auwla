/**
 * Adopting server HTML (`wiki/compiler/delivery.md`, "Adopting existing nodes").
 *
 * Every node a creation call returns (a template's clone, `createTextNode`, `createComment`,
 * `createElement`) gets a number, in the order the program asks for it. The program is the same
 * on the server and in the browser, so the numbers agree. The server writes `<!--[N-->` before
 * each such node. The browser detaches those nodes into a pool before the program runs, which
 * leaves every template's own nodes in the shape its clone would have, so the compiled walk
 * (`firstChild`, `nextSibling`) finds them. The program then runs as a client render, except
 * that creation N takes the server's node N when it has the expected shape, and puts it back
 * with its own insertions.
 *
 * So the result is always what a client render would build: where the two programs disagree,
 * a creation finds nothing that fits and makes a new node, and an unused server node is dropped.
 * Only reuse depends on agreement. Static text and attributes are reset to the template's, and
 * the program writes every dynamic value at creation, so stale server values cannot survive.
 */
import type { DocumentLike } from './environment';
import { getActiveEnvironment, runWithRenderEnvironment } from './kernel';
import type { TemplateNode } from './markup';

export interface Creations {
  /** The number of the next creation. */
  next(): number;
  /** Server: remember a created node's number, to write it into the HTML. */
  note?(node: Node, id: string): void;
  /** Browser: the server's node for creation `id`, while adopting. */
  take?(id: string): Node | undefined;
  /** Set once a template is cloned: compiler-next output, whose HTML carries the numbers. */
  cloned: boolean;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Numbers that only count, and remember each node's number for the server's HTML. */
export function serverCreations(ids: WeakMap<object, string>): Creations {
  let count = 0;
  return {
    cloned: false,
    next: () => count++,
    note: (node, id) => { ids.set(node, id); },
  };
}

/**
 * The document a numbered program creates through. Fragments count but are never written,
 * since inserting one moves its children out.
 */
export function numberedDocument(base: DocumentLike, creations: Creations): DocumentLike {
  const created = <T extends Node>(make: () => T, fits: (node: Node) => boolean): T => {
    const id = String(creations.next());
    const taken = creations.take?.(id);
    if (taken !== undefined && fits(taken)) return taken as T;
    const node = make();
    creations.note?.(node, id);
    return node;
  };

  const own: Partial<DocumentLike> = {
    createTextNode: (data) => created(() => base.createTextNode(data), (node) => {
      if (node.nodeType !== 3) return false;
      (node as Text).data = data;
      return true;
    }),
    createComment: (data) => created(() => base.createComment(data), (node) => {
      if (node.nodeType !== 8) return false;
      (node as Comment).data = data;
      return true;
    }),
    createElement: (tag) => created(() => base.createElement(tag), (node) => emptied(node, tag.toLowerCase(), false)),
    createElementNS: (namespace, tag) => created(
      () => base.createElementNS(namespace, tag),
      (node) => emptied(node, tag, namespace === SVG_NAMESPACE),
    ),
    createDocumentFragment: () => {
      creations.next();
      return base.createDocumentFragment();
    },
  };
  return new Proxy(base, {
    get(target, key) {
      if (key === UNNUMBERED) return base;
      if (Object.hasOwn(own, key)) return own[key as keyof DocumentLike];
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const UNNUMBERED = Symbol('unnumbered document');

/**
 * The document under a numbered one. A template's own nodes are built through it: they are
 * not creations, and how many get built depends on what a cache already holds.
 */
export function unnumbered(document: DocumentLike): DocumentLike {
  return (document as unknown as Record<symbol, DocumentLike | undefined>)[UNNUMBERED] ?? document;
}

/** An element made by `createElement` starts empty: the program sets everything on it. */
function emptied(node: Node, tag: string, svg: boolean): boolean {
  if (!isElement(node, tag, svg)) return false;
  const element = node as Element;
  while (element.attributes.length > 0) element.removeAttribute(element.attributes[0]!.name);
  while (element.firstChild !== null) element.removeChild(element.firstChild);
  return true;
}

function isElement(node: Node, tag: string, svg: boolean): boolean {
  return node.nodeType === 1 && (node as Element).localName === tag
    && ((node as Element).namespaceURI === SVG_NAMESPACE) === svg;
}

/**
 * Creation `id` of a template: the server's nodes when each has the template's shape, or null.
 * A template with several roots was a fragment, whose roots were numbered `id.0`, `id.1`, ….
 */
export function adoptTemplate(
  creations: Creations,
  id: string,
  roots: readonly TemplateNode[],
  namespace: 'html' | 'svg',
): Node | null {
  if (roots.length === 1) {
    const node = creations.take!(id);
    return node !== undefined && fitTemplate(node, roots[0]!, namespace) ? node : null;
  }
  const nodes: Node[] = [];
  for (let index = 0; index < roots.length; index++) {
    const node = creations.take!(`${id}.${index}`);
    if (node === undefined || !fitTemplate(node, roots[index]!, namespace)) return null;
    nodes.push(node);
  }
  const fragment = nodes[0]!.ownerDocument!.createDocumentFragment();
  for (const node of nodes) fragment.appendChild(node);
  return fragment;
}

/** Server: number a template's clone, root by root when it is a fragment. */
export function noteTemplate(creations: Creations, id: string, clone: Node, roots: number): void {
  if (roots === 1) {
    creations.note!(clone, id);
    return;
  }
  let index = 0;
  for (let child = clone.firstChild; child !== null; child = child.nextSibling) creations.note!(child, `${id}.${index++}`);
}

/**
 * Brings a server node to the template's shape: static text and attributes as the template has
 * them, a text or comment the server did not keep made again, anything extra removed. False when
 * an element differs, since then the server built something else.
 */
function fitTemplate(node: Node, template: TemplateNode, namespace: 'html' | 'svg'): boolean {
  if (template === null) {
    if (node.nodeType !== 8) return false;
    (node as Comment).data = '';
    return true;
  }
  if (typeof template === 'string') {
    if (node.nodeType !== 3) return false;
    if ((node as Text).data !== template) (node as Text).data = template;
    return true;
  }

  const tag = template[0];
  const own = tag === 'svg' ? 'svg' : namespace;
  if (!isElement(node, tag, own === 'svg')) return false;
  const element = node as Element;
  const attributes = template[1] === 0 ? [] : template[1];
  for (let index = element.attributes.length - 1; index >= 0; index--) {
    const name = element.attributes[index]!.name;
    if (!attributes.some((candidate, at) => at % 2 === 0 && candidate === name)) element.removeAttribute(name);
  }
  for (let index = 0; index < attributes.length; index += 2) {
    if (element.getAttribute(attributes[index]!) !== attributes[index + 1]) element.setAttribute(attributes[index]!, attributes[index + 1]!);
  }

  // A merged or missing text, or a removed comment, is made again in place.
  const inner = tag === 'foreignObject' ? 'html' : own;
  const document = element.ownerDocument;
  let child = element.firstChild;
  for (let index = 2; index < template.length; index++) {
    const expected = template[index] as TemplateNode;
    if (expected !== null && typeof expected !== 'string') {
      if (child === null || !fitTemplate(child, expected, inner)) return false;
      child = child.nextSibling;
      continue;
    }
    if (child !== null && child.nodeType === (expected === null ? 8 : 3)) {
      fitTemplate(child, expected, inner);
      child = child.nextSibling;
    } else {
      element.insertBefore(expected === null ? document.createComment('') : document.createTextNode(expected), child);
    }
  }
  while (child !== null) {
    const next = child.nextSibling;
    element.removeChild(child);
    child = next;
  }
  return true;
}

/**
 * Detaches every numbered node in [start, end) into the pool, and those inside them, removing
 * the numbers. `<!--[N/-->` stands for a created node HTML cannot hold, such as an empty text:
 * that creation makes a new one.
 */
export function collectCreations(start: Node | null, end: Node | null, pool: Map<string, Node>): void {
  let node = start;
  while (node !== null && node !== end) {
    let next = node.nextSibling;
    if (node.nodeType === 8) {
      const number = /^\[(\d+(?:\.\d+)?)(\/?)$/.exec((node as Comment).data);
      if (number !== null) {
        node.parentNode!.removeChild(node);
        if (number[2] === '' && next !== null && next !== end) {
          const created = next;
          next = created.nextSibling;
          created.parentNode!.removeChild(created);
          pool.set(number[1]!, created);
          collectCreations(created.firstChild, null, pool);
        }
      }
    } else if (node.nodeType === 1) {
      collectCreations(node.firstChild, null, pool);
    }
    node = next;
  }
}

/** Whether a root range holds numbered server HTML, which `adoptRoot` can take. */
export function carriesCreations(open: Node): boolean {
  const first = open.nextSibling;
  return first !== null && first.nodeType === 8 && /^\[\d/.test((first as Comment).data);
}

/**
 * What detaching a node loses, for the elements in [open, end]: an element's scroll position and
 * a playing medium's time. Returns what puts them back on the elements still in the page. An
 * iframe loads its page again when it is moved, which nothing can prevent.
 */
function rememberDetachedState(open: Node, end: Node): () => void {
  const scrolled: [Element, number, number][] = [];
  const media: [HTMLMediaElement, number, boolean][] = [];
  const visit = (node: Node | null, stop: Node | null): void => {
    for (; node !== null && node !== stop; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (element.scrollTop !== 0 || element.scrollLeft !== 0) scrolled.push([element, element.scrollTop, element.scrollLeft]);
      if (element.localName === 'video' || element.localName === 'audio') {
        const medium = element as HTMLMediaElement;
        media.push([medium, medium.currentTime, medium.paused]);
      }
      visit(element.firstChild, null);
    }
  };
  visit(open.nextSibling, end);
  return () => {
    for (const [element, top, left] of scrolled) {
      if (element.isConnected) element.scrollTo?.(left, top);
    }
    for (const [medium, time, paused] of media) {
      if (!medium.isConnected) continue;
      if (medium.currentTime !== time) medium.currentTime = time;
      // `play` reports a refusal through its promise, which is the browser's to decide.
      if (!paused && medium.paused) void medium.play?.()?.catch?.(() => undefined);
    }
  };
}

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * What the user typed, ticked or chose in the server's page before its program ran. The first
 * client render writes each bound control's initial value, and no handler heard the user yet. So
 * afterwards the user's value goes back into each control the render reused, and the control
 * reports it as the user's input would have: `input`, and `change` for a choice. Its handlers then
 * update state, and nothing the user did is lost.
 */
function rememberTyping(open: Node, end: Node): () => void {
  const edited: [FormControl, () => boolean, () => void, boolean][] = [];
  const visit = (node: Node | null, stop: Node | null): void => {
    for (; node !== null && node !== stop; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (element.localName === 'input') {
        const input = element as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          const checked = input.checked;
          if (checked !== input.hasAttribute('checked')) edited.push([input, () => input.checked === checked, () => { input.checked = checked; }, true]);
        } else if (input.type !== 'file' && input.value !== (input.getAttribute('value') ?? '')) {
          const value = input.value;
          edited.push([input, () => input.value === value, () => { input.value = value; }, false]);
        }
      } else if (element.localName === 'textarea') {
        const area = element as HTMLTextAreaElement;
        const value = area.value;
        if (value !== (area.textContent ?? '')) edited.push([area, () => area.value === value, () => { area.value = value; }, false]);
      } else if (element.localName === 'select') {
        const select = element as HTMLSelectElement;
        const options = [...select.options];
        const chosen = options.map((option) => option.selected);
        // With no `selected` attribute, a single select starts on its first enabled option.
        const initial = options.map((option) => option.hasAttribute('selected'));
        if (!select.multiple && !initial.includes(true)) {
          const first = options.findIndex((option) => !option.disabled);
          if (first !== -1) initial[first] = true;
        }
        if (chosen.some((selected, index) => selected !== initial[index])) {
          const same = () => options.every((option, index) => option.selected === chosen[index]);
          edited.push([select, same, () => options.forEach((option, index) => { option.selected = chosen[index]!; }), true]);
        }
      }
      visit(element.firstChild, null);
    }
  };
  visit(open.nextSibling, end);
  return () => {
    for (const [control, same, put, choice] of edited) {
      if (!control.isConnected) continue;
      if (!same()) put();
      const view = control.ownerDocument.defaultView;
      const Event = view?.Event ?? globalThis.Event;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      if (choice) control.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
}

/**
 * Takes the server's nodes in [open, end] for the client render `render` runs, through a numbered
 * document. The markers and anything the pool does not hold leave the page first. Focus, the
 * window's scroll, elements' scroll and playing media survive the moment the nodes are detached,
 * and what the user typed is put back and reported (`rememberTyping`).
 */
export function adoptRoot<T>(open: Node, end: Node, render: () => T): T {
  const document = open.ownerDocument!;
  const focused = document.activeElement;
  const view = document.defaultView;
  const scroll = view === null ? null : [view.scrollX, view.scrollY] as const;
  const restore = rememberDetachedState(open, end);
  const replayTyping = rememberTyping(open, end);

  const pool = new Map<string, Node>();
  collectCreations(open.nextSibling, end, pool);
  const parent = open.parentNode!;
  for (let node: Node | null = open; node !== null;) {
    const next: Node | null = node === end ? null : node.nextSibling;
    parent.removeChild(node);
    node = next;
  }

  let count = 0;
  let adopting = true;
  const creations: Creations = {
    cloned: false,
    next: () => count++,
    take(id) {
      if (!adopting) return undefined;
      const node = pool.get(id);
      pool.delete(id);
      return node;
    },
  };
  let rendered: T;
  try {
    rendered = runWithRenderEnvironment(
      { document: numberedDocument(getActiveEnvironment().document, creations), creations },
      render,
    );
  } finally {
    // Compiled code keeps the numbered document, and with it `take`: server nodes no creation
    // took must not stay reachable through it.
    adopting = false;
    pool.clear();
    // An element (nodeType 1), checked without a global `Element`, which a server has none of.
    if (focused != null && focused.nodeType === 1 && focused.isConnected && document.activeElement !== focused) {
      (focused as HTMLElement).focus?.({ preventScroll: true });
    }
    if (scroll !== null && (view!.scrollX !== scroll[0] || view!.scrollY !== scroll[1])) view!.scrollTo(scroll[0], scroll[1]);
    restore();
  }
  // Only a finished render has the handlers that must hear what the user did.
  replayTyping();
  return rendered;
}
