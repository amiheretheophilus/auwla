/** DOM emission from the render plan. State/write emission joins in the next slice. */
import { b, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { CompileModulesOptions } from '../../options';
import { DEFAULT_RUNTIME_PATH } from '../../options';
import type { ComponentPlan, ModulePlan } from '../plan';
import { copy } from './copy';
import { Names } from './names';
import { statement, stringLiteral } from './quote';
import { emitTemplate } from './template';

/** Preserve module syntax and exports, replacing planned functions on a fresh tree. */
export function emitDom(plan: ModulePlan, options: CompileModulesOptions): Node {
  const module = plan.module.module;
  if (plan.components.size === 0) return copy(module.ast);

  const names = new Names(module);
  const runtime = names.fresh('_MD');
  const runtimePath = JSON.stringify(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
  const hoisted: Statement[] = [statement(`import * as $$runtime from ${runtimePath};`, { runtime })];
  const replacements = new Map<Node, Node>();

  for (const component of plan.components.values()) {
    const markup = component.template.markup === null ? null : names.fresh('_markup');
    if (markup !== null) {
      hoisted.push(statement('const $$markup = $$html;', {
        markup,
        html: stringLiteral(component.template.markup!),
      }));
    }
    replacements.set(component.fn, emitComponent(component, names, runtime, markup));
  }

  const output = copy(module.ast, replacements);
  // A module's directive prologue must remain before generated declarations.
  let insertion = 0;
  for (const entry of output.body) {
    if (!is.ExpressionStatement(entry) || typeof entry.directive !== 'string') break;
    insertion++;
  }
  output.body.splice(insertion, 0, ...hoisted);
  return output;
}

function emitComponent(plan: ComponentPlan, names: Names, runtime: string, markup: string | null): Node {
  const document = names.fresh('_document');
  const id = names.fresh('_id');
  const parent = names.fresh('_parent');
  const body: Statement[] = [
    ...copy(plan.setup),
    statement('const $$document = $$runtime.getActiveEnvironment().document;', { document, runtime }),
  ];
  const used = new Set(plan.template.roots);
  for (const site of plan.sites) used.add(site.node);
  const template = emitTemplate(plan.template, used, { names, runtime, document, markup });
  body.push(...template.statements);

  // Placeholders keep neighbouring values as distinct text nodes after parsing.
  const texts = new Map<number, string>();
  for (const site of plan.sites) {
    if (site.kind !== 'text') continue;
    const text = names.fresh('_text');
    texts.set(site.node, text);
    body.push(statement('const $$text = $$document.createTextNode("");', { text, document }));
    body.push(statement('$$placeholder.replaceWith($$text);', { placeholder: template.ref(site.node), text }));
  }

  // This slice evaluates sites once at mount. The following state slice supplies
  // update statements and commit instrumentation; no owner-wide replay is added.
  const events = new Map<string, { node: string; event: string; handler: string }>();
  for (const site of plan.sites) {
    const node = template.ref(site.node);
    const value = copy(site.expression);
    if (site.kind === 'text') {
      body.push(statement('$$runtime.setTextData($$node, $$value);', { runtime, node: texts.get(site.node)!, value }));
    } else if (site.kind === 'property') {
      body.push(statement('$$node[$$name] = $$value;', { node, name: stringLiteral(site.name), value }));
    } else if (site.kind === 'attribute') {
      const attribute = names.fresh('_attribute');
      body.push(statement('const $$attribute = $$value;', { attribute, value }));
      body.push(statement(`if ($$attribute != null && $$attribute !== false) {
        $$node.setAttribute($$name, $$attribute === true ? "" : $$runtime.textValue($$attribute));
      } else {
        $$node.removeAttribute($$name);
      }`, { attribute, node, runtime, name: stringLiteral(site.name) }));
    } else {
      const handler = names.fresh('_handler');
      body.push(statement('const $$handler = $$value;', { handler, value }));
      // Evaluate every attribute, but install only the last handler for a name,
      // as the JSX props object does for repeated event attributes.
      events.set(`${site.node}:${site.event}`, { node, event: site.event, handler });
    }
  }
  for (const { node, event, handler } of events.values()) {
    body.push(statement('if (typeof $$handler === "function") $$node.addEventListener($$event, $$handler);', {
      handler, node, event: stringLiteral(event),
    }));
  }

  const roots = plan.template.roots.map((index) => texts.get(index) ?? template.ref(index));
  if (roots.length === 1) {
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: roots[0]! }) }));
  } else {
    const fragment = names.fresh('_fragment');
    body.push(statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document }));
    for (const root of roots) body.push(statement('$$fragment.appendChild($$root);', { fragment, root }));
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: fragment }) }));
  }

  const fn = copy(plan.fn);
  fn.params = [b.Identifier({ name: id }), b.Identifier({ name: parent }), ...fn.params];
  fn.body = b.BlockStatement({ body });
  if (fn.type === 'ArrowFunctionExpression') fn.expression = false;
  return fn;
}
