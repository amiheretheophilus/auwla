/**
 * Creating a component's template nodes. With markup, one cached template is
 * cloned (`materializeMarkup`); without (`Template.markup` is null), the nodes
 * are created one by one in the same order, so sites address them the same way.
 */
import { b } from 'yuku-ast';
import type { Expression, Statement } from 'yuku-parser';
import type { Site, Template } from '../plan';
import type { Names } from './names';
import { expression, numberLiteral, statement, statements, stringLiteral } from './quote';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export interface TemplateEmit {
  readonly statements: Statement[];
  /** The variable holding node `index`. */
  ref(index: number): string;
}

export interface TemplateNames {
  readonly names: Names;
  readonly runtime: string;
  readonly document: string;
  /** The module-level constant holding the markup, when there is markup. */
  readonly markup: string | null;
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
 * A template's nodes and its sites' text nodes. Where no root is itself a site,
 * the old compiler's shape is used: the nodes are built once per document with
 * DOM calls, text slots included as text nodes, then cloned, and each node is
 * reached through `firstChild` and `nextSibling` (`runtime/src/markup.ts`,
 * `cloneTemplate`). Hydration and server documents keep the general creation,
 * emitted as the fallback.
 */
export function emitNodes(template: Template, sites: readonly Site[], context: TemplateNames): NodesEmit {
  const used = new Set(template.roots);
  for (const site of sites) used.add(site.node);
  const general = () => {
    const created = emitTemplate(template, used, context);
    const slots = prepareTemplateSites(template, sites, created, context);
    return { statements: [...created.statements, ...slots.statements], ref: slots.ref, root: slots.root };
  };
  // A root text or region needs a movable fragment (`prepareTemplateSites`).
  const slotted = new Set(sites.filter((site) => site.kind === 'text' || site.kind === 'conditional').map((site) => site.node));
  if (template.roots.length === 0 || template.roots.some((root) => slotted.has(root))) return general();

  const { names, runtime } = context;
  const texts = new Set(sites.filter((site) => site.kind === 'text').map((site) => site.node));
  const inherits = context.namespace !== undefined && inheritedNodes(template).size > 0;
  const cache = names.fresh('_template');
  const build = names.fresh('_buildTemplate');
  const document = names.fresh('_document');
  const namespace = names.fresh('_namespace');
  const created = createNodes(template, { ...context, document, namespace: inherits ? namespace : undefined }, false, texts);
  const roots = template.roots.map((index) => created.ref(index));
  const fragment = names.fresh('_fragment');
  const result = roots.length === 1 ? [b.ReturnStatement({ argument: b.Identifier({ name: roots[0]! }) })] : [
    statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document }),
    ...statements(`${fragment}.append(${roots.join(', ')});`),
    b.ReturnStatement({ argument: b.Identifier({ name: fragment }) }),
  ];
  names.hoisted.push(statement('const $$cache = $$runtime.createTemplateCache();', { cache, runtime }));
  const declaration = statement(`function ${build}($$document, $$namespace) {}`, { document, namespace });
  if (declaration.type === 'FunctionDeclaration') declaration.body!.body = [...created.statements, ...result];
  names.hoisted.push(declaration);

  // Each node the sites or caller need gets one variable, set by either path.
  const outer = new Map<number, string>();
  for (const index of [...used].sort((left, right) => left - right)) {
    outer.set(index, names.fresh(texts.has(index) ? '_text' : nodeName(template, index)));
  }
  const clone = names.fresh('_clone');
  const parents = new Map<number, number>();
  template.nodes.forEach((node, index) => {
    if (node.kind === 'element') for (const child of node.children) parents.set(child, index);
  });
  const reached = new Map<number, string>();
  const navigation: Statement[] = [];
  const reach = (index: number): string => {
    const known = reached.get(index);
    if (known !== undefined) return known;
    let path: string;
    const parent = parents.get(index);
    const siblings = parent === undefined ? template.roots : (template.nodes[parent] as { children: readonly number[] }).children;
    const position = siblings.indexOf(index);
    if (parent === undefined && template.roots.length === 1) path = clone;
    else if (position === 0) path = `${parent === undefined ? clone : reach(parent)}.firstChild`;
    else path = `${reach(siblings[position - 1]!)}.nextSibling`;
    const name = names.fresh('_node');
    navigation.push(statement(`const ${name} = ${path};`));
    reached.set(index, name);
    return name;
  };
  for (const [index, name] of outer) navigation.push(statement(`${name} = ${reach(index)};`));
  const fallback = general();
  const assignments = [...outer].map(([index, name]) => statement(`${name} = ${template.roots.includes(index) ? fallback.root(index) : fallback.ref(index)};`));
  return {
    statements: [
      b.VariableDeclaration({ kind: 'let', declarations: [...outer.values()].map((name) => b.VariableDeclarator({ id: b.Identifier({ name }), init: null })) }),
      statement('const $$clone = $$runtime.cloneTemplate($$cache, $$namespace, $$build);', {
        clone, runtime, cache, build, namespace: inherits ? context.namespace! : expression('void 0'),
      }),
      b.IfStatement({
        test: expression('$$clone !== null', { clone }),
        consequent: b.BlockStatement({ body: navigation }),
        alternate: b.BlockStatement({ body: [...fallback.statements, ...assignments] }),
      }),
    ],
    ref: (index) => outer.get(index)!,
    root: (index) => outer.get(index)!,
  };
}

/** Create the nodes that `used` lists; with markup, the others exist but get no variable. */
export function emitTemplate(template: Template, used: ReadonlySet<number>, context: TemplateNames): TemplateEmit {
  return context.markup === null
    ? createNodes(template, context)
    : materialize(template, used, context);
}

/** Text slots become text nodes; a root region needs a movable fragment owner. */
export function prepareTemplateSites(template: Template, sites: readonly Site[], emitted: TemplateEmit, context: TemplateNames) {
  const statements: Statement[] = [];
  const texts = new Map<number, string>();
  const roots = new Map<number, string>();
  for (const site of sites) {
    if (site.kind === 'text') {
      const text = context.names.fresh('_text');
      texts.set(site.node, text);
      statements.push(statement('const $$text = $$document.createTextNode("");', { text, document: context.document }));
      statements.push(statement('$$slot.replaceWith($$text);', { slot: emitted.ref(site.node), text }));
      if (template.roots.includes(site.node)) {
          // A root value can expand into several nodes. Move its whole range
          // into the caller's tree instead of returning only its text anchor.
        const fragment = context.names.fresh('_valueRoot');
        roots.set(site.node, fragment);
        statements.push(statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document: context.document }));
        statements.push(statement('$$fragment.appendChild($$text);', { fragment, text }));
      }
    } else if (site.kind === 'conditional' && template.roots.includes(site.node)) {
      const fragment = context.names.fresh('_regionRoot');
      roots.set(site.node, fragment);
      statements.push(statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document: context.document }));
      statements.push(statement('$$fragment.appendChild($$slot);', { fragment, slot: emitted.ref(site.node) }));
    }
  }
  return {
    statements,
    ref: (index: number) => texts.get(index) ?? emitted.ref(index),
    root: (index: number) => roots.get(index) ?? texts.get(index) ?? emitted.ref(index),
  };
}

function materialize(template: Template, used: ReadonlySet<number>, context: TemplateNames): TemplateEmit {
  const nodes = context.names.fresh('_nodes');
  let create = expression('$$runtime.materializeMarkup($$markup)', {
    runtime: context.runtime, markup: context.markup!,
  });
  if (context.namespace !== undefined && inheritedNodes(template).size > 0) {
    // Cloned markup is parsed as HTML; in an SVG slot, build the nodes instead.
    const svg = createNodes(template, context, true);
    const body = [...svg.statements, b.ReturnStatement({
      argument: b.ArrayExpression({
        elements: template.nodes.map((_, index) => b.Identifier({ name: svg.ref(index) })),
      }),
    })];
    const factory = b.ArrowFunctionExpression({
      id: null, params: [], body: b.BlockStatement({ body }),
      async: false, generator: false, expression: false,
    });
    create = expression('$$namespace === "svg" ? $$factory() : $$html', {
      namespace: context.namespace, factory, html: create,
    });
  }
  const output = [statement('const $$nodes = $$create;', { nodes, create })];

  const refs = new Map<number, string>();
  for (const index of [...used].sort((left, right) => left - right)) {
    const name = context.names.fresh(nodeName(template, index));
    refs.set(index, name);
    output.push(statement(`const ${name} = ${nodes}[$$index];`, { index: numberLiteral(index) }));
  }
  return { statements: output, ref: (index) => refs.get(index)! };
}

/**
 * With `inSvg`, the caller already knows the consuming slot is SVG. `texts`
 * are placeholders created as text nodes, for a template whose text sites
 * write them directly (`emitNodes`); other placeholders are comments.
 */
function createNodes(template: Template, context: TemplateNames, inSvg = false, texts: ReadonlySet<number> = new Set()): TemplateEmit {
  const output: Statement[] = [];
  const refs = template.nodes.map((_, index) => context.names.fresh(nodeName(template, index)));
  const holes = { document: context.document };
  const inherited = inheritedNodes(template);

  template.nodes.forEach((node, index) => {
    const name = refs[index]!;
    if (node.kind === 'text') {
      output.push(statement(`const ${name} = $$document.createTextNode($$text);`, { ...holes, text: stringLiteral(node.text) }));
      return;
    }
    if (node.kind === 'placeholder') {
      output.push(statement(texts.has(index)
        ? `const ${name} = $$document.createTextNode("");`
        : `const ${name} = $$document.createComment("");`, holes));
      return;
    }

    const tag = stringLiteral(node.tag);
    const svg = node.namespace === 'svg' || (inSvg && inherited.has(index));
    let create = svg
      ? expression('$$document.createElementNS($$svg, $$tag)', { ...holes, svg: stringLiteral(SVG_NAMESPACE), tag })
      : expression('$$document.createElement($$tag)', { ...holes, tag });
    if (!svg && context.namespace !== undefined && inherited.has(index)) {
      create = expression('$$namespace === "svg" ? $$document.createElementNS($$svg, $$tag) : $$html', {
        ...holes, namespace: context.namespace, svg: stringLiteral(SVG_NAMESPACE), tag, html: create,
      });
    }
    output.push(statement('const $$name = $$create;', { name, create }));
    for (const attribute of node.attributes) {
      output.push(statement(`${name}.setAttribute($$name, $$value);`, {
        name: stringLiteral(attribute.name),
        value: stringLiteral(attribute.value),
      }));
    }
    if (node.children.length > 0) {
      const children = node.children.map((child) => refs[child]!).join(', ');
      output.push(...statements(`${name}.append(${children});`));
    }
  });
  return { statements: output, ref: (index) => refs[index]! };
}

/**
 * The HTML-planned elements that become SVG when the consuming slot is SVG:
 * SVG tags reached from a root through SVG tags. Any other tag stays HTML and
 * so does what it contains; a foreignObject restarts HTML below it.
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
function nodeName(template: Template, index: number): string {
  const node = template.nodes[index]!;
  if (node.kind === 'element') return `_${node.tag.replace(/[^A-Za-z0-9_$]/g, '_')}`;
  if (node.kind === 'placeholder') return '_slot';
  return '_static';
}
