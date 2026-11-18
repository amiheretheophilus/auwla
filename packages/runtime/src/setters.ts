/**
 * @file setters.ts
 * DOM writes for compiled sites: text, listeners, attributes and classes.
 *
 * The old compiler's value-cached setters (`setText`, `setAttr`, `setClass`, `setProp`,
 * `setStyle`, with a per-component slot cache) went with that compiler on 2026-11-18;
 * the compiler compares values at each site before writing.
 */

import { classValue } from './dom-values';
import { isAriaAttribute, isHtmlBooleanAttribute } from './html-attributes';
import { batchlessListener, type WriteBatch } from './write-batch';

/**
 * Seed a dynamic text node, including one adopted from server markup, or update
 * ordinary component text. List rows use compiler-emitted string slots.
 */
export function setTextData(node: Text, value: unknown): void {
  const next = textValue(value);
  if (node.data !== next) node.data = next;
}

/**
 * The compiler's event site: replace `previous` with the authored value,
 * wrapped so its writes commit as one batch. A value that is not a function
 * installs nothing. Returns what is installed, the next call's `previous`.
 */
export function setListener(
  node: Node,
  event: string,
  previous: EventListener | undefined,
  value: unknown,
  batch: WriteBatch | null,
): EventListener | undefined {
  if (previous !== undefined) node.removeEventListener(event, previous);
  if (typeof value !== 'function') return undefined;
  const listener = batch === null ? batchlessListener(value as EventListener) : batch.listener(value as EventListener);
  node.addEventListener(event, listener);
  return listener;
}

/**
 * A list row's event site. Every row of a batch shares one native listener, which
 * runs the handler stored on its element (`wiki/decisions.md`, 2026-10-26: not
 * delegation, so phase, order, `currentTarget` and detached dispatch stay native).
 * It removes only the per-row wrapper closure.
 */
export function setRowListener(node: Node, event: string, handler: Function, batch: WriteBatch): void {
  const shared = (batch.rowListeners ??= {})[event] ??= sharedListener(batch, event);
  (node as unknown as Record<string, Function>)[shared.key] = handler;
  node.addEventListener(event, shared.listener);
}

/** One event's listener for all the rows of a batch (`WriteBatch.rowListeners`). */
export interface SharedListener {
  /** Where each element holds its handler. */
  readonly key: string;
  readonly listener: EventListener;
}

function sharedListener(batch: WriteBatch, event: string): SharedListener {
  const key = `$mmd:${event}`;
  return {
    key,
    listener: batch.listener(function (this: Record<string, Function>, ...args: unknown[]) {
      return Reflect.apply(this[key]!, this, args);
    } as EventListener),
  };
}

/** Adjacent children sharing one text node, each shown as it would be alone. */
export function joinText(parts: readonly unknown[]): string {
  let text = '';
  for (const part of parts) text += textValue(part);
  return text;
}

/** Attribute sites: nullish values omit; boolean and ARIA rules as below. */
export function setAttributeValue(node: Element, name: string, value: unknown): void {
  const omitFalse = value === false && !isAriaAttribute(name);
  if (value == null || omitFalse) {
    node.removeAttribute(name);
    return;
  }

  // ARIA booleans are text in both render paths. Presence-only true applies
  // only to actual HTML boolean attributes, never to SVG or arbitrary names.
  let next: string;
  if (value === true) {
    const html = node.namespaceURI !== 'http://www.w3.org/2000/svg';
    next = html && isHtmlBooleanAttribute(name) ? '' : 'true';
  } else if (value === false) {
    next = 'false';
  } else {
    next = textValue(value);
  }
  node.setAttribute(name, next);
}

/**
 * `setAttributeValue` for `class`, at half the cost of `setAttribute`. A value can also be an array
 * or an object of conditions (`classValue`). An SVG element's `className` is an object, and read-only.
 */
export function setClassAttribute(node: Element, value: unknown): void {
  if (value == null || value === false) {
    node.removeAttribute('class');
  } else if (typeof node.className === 'string') {
    node.className = classValue(value);
  } else {
    node.setAttribute('class', classValue(value));
  }
}

/** Normalize a dynamic text slot before comparing its cached value. */
export function textValue(value: unknown): string {
  return value == null || typeof value === 'boolean' ? '' : String(value);
}
