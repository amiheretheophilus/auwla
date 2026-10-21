/**
 * plan: graph → one `ModulePlan` per module (`wiki/compiler/core.md`, "plan").
 *
 * Phase 3 plans a component whose body is setup statements followed by one
 * `return` of markup. Markup anywhere else (a conditional return, a variable, a
 * helper) is compiled by later phases, which say so in their error.
 */
import { is, walk } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import { isReactive, type SemanticGraph } from '../graph';
import type { InputQueries } from '../graph/inputs';
import { isWrittenGlobal, runnerOf, type ResolvedModule } from '../resolve';
import type { FunctionNode } from '../resolve/functions';
import type { ComponentPlan, ModulePlan } from './model';
import { buildTemplate, containsJsx, unsupported, type TemplateContext } from './template';
import { unwrap } from './jsx';

export type { ComponentPlan, ModulePlan, Site, Template, TemplateNode } from './model';

export function planModules(
  graph: SemanticGraph,
  queries: InputQueries,
  components: ReadonlySet<Node>,
): ModulePlan[] {
  return graph.resolved.modules.map((entry) => planModule(graph, queries, components, entry));
}

function planModule(
  graph: SemanticGraph,
  queries: InputQueries,
  components: ReadonlySet<Node>,
  entry: ResolvedModule,
): ModulePlan {
  const module = entry.module;
  const context: TemplateContext = {
    path: entry.path,
    source: module.source,
    reactive: (expression) => readsReactive(graph, queries, entry, expression),
  };

  const plans = new Map<Node, ComponentPlan>();
  for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (components.has(fn)) plans.set(fn, planComponent(fn, context));
  }

  // Markup that no planned component returns belongs to a later phase.
  for (const jsx of module.findAll(['JSXElement', 'JSXFragment'])) {
    const owner = runnerOf(module, jsx);
    const plan = owner === null ? undefined : plans.get(owner);
    if (plan === undefined) unsupported(context, jsx, 'markup outside a component', 6);
  }
  return { module: entry, components: plans };
}

function planComponent(fn: FunctionNode, context: TemplateContext): ComponentPlan {
  const { setup, markup } = splitBody(fn, context);
  for (const statement of setup) {
    if (containsJsx(statement)) unsupported(context, statement, 'markup in setup code', 4);
  }
  const { template, sites } = buildTemplate(markup, context);
  return { fn, setup, template, sites };
}

/** `{ …setup; return <markup />; }`, or an arrow whose body is the markup. */
function splitBody(fn: FunctionNode, context: TemplateContext) {
  type Markup = Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>;
  const body = fn.body;
  if (body === null) return unsupported(context, fn, 'a component without a body', 6);

  if (!is.BlockStatement(body)) {
    const markup = unwrap(body as Expression);
    if (!is.JSXElement(markup) && !is.JSXFragment(markup)) {
      return unsupported(context, body, 'a component that returns something other than markup', 4);
    }
    return { setup: [] as Statement[], markup: markup as Markup };
  }

  const last = body.body.at(-1);
  const argument = is.ReturnStatement(last) && last.argument !== null ? unwrap(last.argument) : null;
  if (argument === null || (!is.JSXElement(argument) && !is.JSXFragment(argument))) {
    return unsupported(context, last ?? fn, 'a component that does not end by returning markup', 4);
  }
  const setup = body.body.slice(0, -1) as Statement[];
  const earlyReturn = setup.some((statement) => is.ReturnStatement(statement) || containsReturn(statement, fn));
  if (earlyReturn) unsupported(context, fn, 'early returns', 4);
  return { setup, markup: argument as Markup };
}

/** A `return` of the component itself inside a setup statement, not one in a nested function. */
function containsReturn(statement: Node, fn: FunctionNode): boolean {
  let found = false;
  walk(statement, {
    enter(node, ctx) {
      if (is.Function(node) && node !== fn) {
        ctx.skip();
      } else if (is.ReturnStatement(node)) {
        found = true;
        ctx.stop();
      }
    },
  });
  return found;
}

/**
 * Whether evaluating `expression` reads something that can change: a reactive
 * binding, or a global the program writes. An unknown call alone does not make
 * it so (`wiki/compiler/output.md`, "Phase 3 design", rule 4).
 */
function readsReactive(graph: SemanticGraph, queries: InputQueries, entry: ResolvedModule, expression: Expression): boolean {
  if (expression.end === 0) return false;
  const inputs = queries.inputsOf(entry.module, expression);
  return inputs.reads.some((read) => {
    const binding = read.binding ?? read.reference.binding;
    if (binding === null) return isWrittenGlobal(graph.resolved.globals, read.reference.name);
    const node = graph.bindings.get(binding);
    return node === undefined ? false : isReactive(node);
  });
}
