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
  if (context.namespace !== undefined) {
    const svg = createNodes(template, context);
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

function createNodes(template: Template, context: TemplateNames): TemplateEmit {
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
      output.push(statement(`const ${name} = $$document.createComment("");`, holes));
      return;
    }

    const tag = stringLiteral(node.tag);
    let create = node.namespace === 'svg'
      ? expression('$$document.createElementNS($$svg, $$tag)', { ...holes, svg: stringLiteral(SVG_NAMESPACE), tag })
      : expression('$$document.createElement($$tag)', { ...holes, tag });
    if (node.namespace === 'html' && context.namespace !== undefined && inherited.has(index)) {
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

/** A foreignObject explicitly restarts HTML, including in an inherited SVG tree. */
function inheritedNodes(template: Template): ReadonlySet<number> {
  const inherited = new Set<number>();
  function visit(index: number, inherits: boolean): void {
    if (inherits) {
      inherited.add(index);
    }
    const node = template.nodes[index]!;
    if (node.kind !== 'element') {
      return;
    }
    const childrenInherit = inherits && node.tag !== 'foreignObject';
    for (const child of node.children) {
      visit(child, childrenInherit);
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
