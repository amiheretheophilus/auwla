/** Test-only atomic preparation: evaluate active components without touching DOM. */
import type { Component, Element } from './runtime';
import { $waiting, Source, Waiting } from './sources';

export function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && 'tag' in value && 'props' in value && 'children' in value;
}

export function elementPosition(node: Element, position: string): string {
  if (node.site !== undefined) position += `/site=${String(node.site)}`;
  if (node.props.key !== undefined && node.props.key !== null) position += `/key=${String(node.props.key)}`;
  return position;
}

export function childPosition(child: unknown, index: number, position: string): string {
  const key = isElement(child) ? child.props.key : undefined;
  return `${position}/${key === undefined || key === null ? `#${index}` : `key=${String(key)}`}`;
}

interface ComponentOutput {
  id: string;
  output: unknown;
  waiting: Waiting | undefined;
}

export class Preparation {
  readonly outputs = new Map<string, unknown>();
  readonly instances = new Set<string>();
  private readonly sources = new Set<Source>();

  constructor(private readonly evaluate: (node: Element, component: Component, position: string) => ComponentOutput) {}

  get waiting(): Waiting | undefined {
    return this.sources.size ? new Waiting([...this.sources]) : undefined;
  }

  private collect(waiting: Waiting | undefined): void {
    for (const source of waiting?.sources ?? []) this.sources.add(source);
  }

  visit(node: unknown, position: string): void {
    if (node instanceof Waiting) {
      this.collect(node);
    } else if (Array.isArray(node)) {
      this.children(node, position);
    } else if (isElement(node)) {
      this.element(node, elementPosition(node, position));
    }
  }

  /** The boundary's own position has already been assigned by the renderer. */
  element(node: Element, position: string): void {
    if (typeof node.tag === 'function') {
      const { id, output, waiting } = this.evaluate(node, node.tag, position);
      this.instances.add(id);
      this.outputs.set(id, output);
      this.collect(waiting);
      this.visit(output, `${id}>`);
      return;
    }
    // Group/Fragment policies do not publish inner fallbacks during preparation.
    if (typeof node.tag === 'string') this.collect($waiting(Object.values(node.props)));
    this.children(node.children, position);
  }

  private children(children: unknown[], position: string): void {
    children.forEach((child, index) => this.visit(child, childPosition(child, index, position)));
  }
}
