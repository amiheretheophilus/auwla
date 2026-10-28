/**
 * Creating a template's nodes. Each template is one module-level description
 * (`runtime/src/markup.ts`, `TemplateNode`); the runtime builds it once per
 * document and namespace and clones it, and sites reach their nodes through
 * `firstChild` and `nextSibling`.
 */
import { b } from 'yuku-ast';
import type { Expression, Statement } from 'yuku-parser';
import type { Site, Template } from '../plan';
import type { Names } from './names';
import { expression, statement, stringLiteral } from './quote';

export interface TemplateNames {
  readonly names: Names;
  readonly runtime: string;
  readonly document: string;
  /** A component inherits the namespace where its returned roots are consumed. */
  readonly namespace?: string | Expression;
}

export interface NodesEmit {
  readonly statements: Statement[];
  /** The node a site writes: a text site's text node, otherwise the template node. */
  ref(index: number): string;
  /** A top-level node, or the fragment that carries a root text or region. */
  root(index: number): string;
}

/**
 * A template's nodes and its sites' text nodes. Text slots are text nodes in
 * the description, so a text site writes its node directly. A root that is a
 * text or region site is moved into its own fragment: its value can expand
 * into several nodes, and the caller inserts that whole range.
 */
export function emitNodes(template: Template, sites: readonly Site[], context: TemplateNames): NodesEmit {
  const { names, runtime } = context;
  const used = new Set(template.roots);
  for (const site of sites) used.add(site.node);
  const texts = new Set(sites.filter((site) => site.kind === 'text').map((site) => site.node));
  const slotted = new Set(sites.filter((site) => site.kind === 'text' || site.kind === 'conditional').map((site) => site.node));
  if (template.roots.length === 0) {
    return { statements: [], ref: missing, root: missing };
  }

  const cache = names.fresh('_template');
  names.hoisted.push(statement('const $$cache = $$runtime.createTemplateCache($$roots);', {
    cache, runtime, roots: b.ArrayExpression({ elements: template.roots.map((root) => describe(template, root, texts)) }),
  }));
  // Elements planned in HTML follow the destination where one is given. A
  // template planned in SVG starts there; otherwise HTML is the default.
  const inherits = context.namespace !== undefined && inheritedNodes(template).size > 0;
  const clone = names.fresh('_clone');
  const namespace = inherits ? context.namespace! : template.namespace === 'svg' ? stringLiteral('svg') : null;
  const output = [namespace === null
    ? statement('const $$clone = $$runtime.cloneTemplate($$cache);', { clone, runtime, cache })
    : statement('const $$clone = $$runtime.cloneTemplate($$cache, $$namespace);', { clone, runtime, cache, namespace })];

  const parents = new Map<number, number>();
  template.nodes.forEach((node, index) => {
    if (node.kind === 'element') for (const child of node.children) parents.set(child, index);
  });
  const reached = new Map<number, string>();
  const reach = (index: number): string => {
    const known = reached.get(index);
    if (known !== undefined) return known;
    const parent = parents.get(index);
    const siblings = parent === undefined ? template.roots : (template.nodes[parent] as { children: readonly number[] }).children;
    const position = siblings.indexOf(index);
    let path: string;
    if (parent === undefined && template.roots.length === 1) path = clone;
    else if (position === 0) path = `${parent === undefined ? clone : reach(parent)}.firstChild`;
    else path = `${reach(siblings[position - 1]!)}.nextSibling`;
    if (path === clone) {
      reached.set(index, clone);
      return clone;
    }
    const name = names.fresh(used.has(index) ? nodeName(template, index, texts) : '_node');
    output.push(statement(`const ${name} = ${path};`));
    reached.set(index, name);
    return name;
  };
  for (const index of [...used].sort((left, right) => left - right)) reach(index);

  // Navigation is complete before any root leaves the cloned fragment.
  const roots = new Map<number, string>();
  for (const index of template.roots) {
    if (!slotted.has(index)) continue;
    const fragment = names.fresh(texts.has(index) ? '_valueRoot' : '_regionRoot');
    roots.set(index, fragment);
    output.push(statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document: context.document }));
    output.push(statement('$$fragment.appendChild($$node);', { fragment, node: reached.get(index)! }));
  }
  return {
    statements: output,
    ref: (index) => reached.get(index)!,
    root: (index) => roots.get(index) ?? reached.get(index)!,
  };
}

function missing(index: number): never {
  throw new Error(`memo-dom: template node ${index} does not exist`);
}

/** A text site's placeholder is an empty text node; a region's is a comment. */
function describe(template: Template, index: number, texts: ReadonlySet<number>): Expression {
  const node = template.nodes[index]!;
  if (node.kind === 'text') return stringLiteral(node.text);
  if (node.kind === 'placeholder') return texts.has(index) ? stringLiteral('') : b.Literal({ value: null, raw: 'null' });
  const attributes = node.attributes.length === 0
    ? expression('0')
    : b.ArrayExpression({ elements: node.attributes.flatMap((attribute) => [stringLiteral(attribute.name), stringLiteral(attribute.value)]) });
  return b.ArrayExpression({
    elements: [stringLiteral(node.tag), attributes, ...node.children.map((child) => describe(template, child, texts))],
  });
}

/**
 * The HTML-planned elements that become SVG when the consuming slot is SVG:
 * every element reached from a root without crossing a foreignObject, which
 * restarts HTML below it. The runtime's builder applies the same rule
 * (`buildNode`).
 */
export function inheritedNodes(template: Template): ReadonlySet<number> {
  const inherited = new Set<number>();
  function visit(index: number, inherits: boolean): void {
    const node = template.nodes[index]!;
    if (node.kind !== 'element') {
      return;
    }
    if (inherits && node.namespace === 'html') {
      // Namespace follows the destination, including custom tags. A tag-name
      // table cannot prove that an authored value will only be consumed in HTML.
      inherited.add(index);
    }
    for (const child of node.children) {
      visit(child, inherits && node.tag !== 'foreignObject');
    }
  }
  for (const root of template.roots) {
    visit(root, true);
  }
  return inherited;
}

/** `_button`, `_text`: readable names for generated node variables. */
function nodeName(template: Template, index: number, texts: ReadonlySet<number>): string {
  const node = template.nodes[index]!;
  if (node.kind === 'element') return `_${node.tag.replace(/[^A-Za-z0-9_$]/g, '_')}`;
  if (node.kind === 'placeholder') return texts.has(index) ? '_text' : '_slot';
  return '_static';
}
