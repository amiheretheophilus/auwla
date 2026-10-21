/**
 * plan: graph → one `ModulePlan` per module (`wiki/compiler/core.md`, "plan").
 *
 * Phase 3 plans a component whose body is setup statements followed by one
 * `return` of markup. Markup anywhere else (a conditional return, a variable, a
 * helper) is compiled by later phases, which say so in their error.
 */
import { is, walk } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import { isReactive, type BindingNode, type SemanticGraph } from '../graph';
import { variableDeclaration, type InputQueries } from '../graph/inputs';
import { isWrittenGlobal, runnerOf, type ResolvedModule } from '../resolve';
import type { FunctionNode } from '../resolve/functions';
import type { ComponentPlan, ModulePlan } from './model';
import { buildTemplate, containsJsx, unsupported, type TemplateContext } from './template';
import { unwrap } from './jsx';
import { planLocalState } from '../../features/state/plan';
import { planMutations, planReadonlyBindings, planWrites } from '../../features/handlers/plan';
import { planMemos } from '../../features/derived/plan';
import type { MemoGroupPlan } from './model';
import type { SharedOwnerPlan, SharedReadPlan } from './model';
import { planSharedReads, sharedSetup } from '../../features/state/shared-plan';
import { planReceiverTargets } from '../../features/handlers/receivers';
import { storageOwner } from './storage';

export type { ComponentPlan, ModulePlan, Site, Template, TemplateNode } from './model';

export function planModules(
  graph: SemanticGraph,
  queries: InputQueries,
  components: ReadonlySet<Node>,
): ModulePlan[] {
  const state = planLocalState(graph, components);
  const sharedReads = planSharedReads(graph, components);
  const owners = new Set<Node | null>([...components, ...[...sharedReads.keys()].map(storageOwner)]);
  const memos = planMemos(graph, queries, owners);
  return graph.resolved.modules.map((entry) => planModule(graph, queries, components, entry, state, memos, sharedReads));
}

function planModule(
  graph: SemanticGraph,
  queries: InputQueries,
  components: ReadonlySet<Node>,
  entry: ResolvedModule,
  state: ReadonlyMap<Node, readonly BindingNode[]>,
  memos: ReadonlyMap<Node | null, readonly MemoGroupPlan[]>,
  sharedReads: ReadonlyMap<BindingNode, SharedReadPlan>,
): ModulePlan {
  const module = entry.module;
  const context: TemplateContext = {
    path: entry.path,
    source: module.source,
    reactive: (expression) => readsReactive(graph, queries, entry, expression),
  };

  const plans = new Map<Node, ComponentPlan>();
  const lexicalBlocks = new Set([...sharedReads.keys()].filter((binding) => binding.binding.module === module)
    .map(storageOwner).filter((owner) => is.BlockStatement(owner)));
  for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (!components.has(fn)) continue;
    const computations = memos.get(fn) ?? [];
    const targets = computations.flatMap((group) => group.computations.flatMap((memo) => memo.targets));
    const local = [...new Set([...(state.get(fn) ?? []), ...targets])];
    const component = planComponent(fn, context);
    const siteInputs = new Map<Expression, readonly BindingNode[]>();
    const dynamicSites = new Set<Expression>();
    for (const site of component.sites) {
      const inputs = new Set<BindingNode>();
      if (site.expression.end !== 0) {
        const facts = queries.inputsOf(module, site.expression);
        if (facts.opaque || facts.reads.some((read) => {
          const binding = read.binding ?? read.reference.binding;
          const node = binding === null ? undefined : graph.bindings.get(binding);
          return node !== undefined && storageOwner(node) !== fn;
        })) dynamicSites.add(site.expression);
        for (const read of queries.inputsOf(module, site.expression).reads) {
          const binding = read.binding ?? read.reference.binding;
          const node = binding === null ? undefined : graph.bindings.get(binding);
          if (node !== undefined) inputs.add(node);
        }
      }
      siteInputs.set(site.expression, [...inputs]);
    }
    const writes = planWrites(local);
    const mutations = planMutations(local);
    const readonlyBindings = planReadonlyBindings(local);
    const takeovers = targets.filter((target) => {
      return target.takeovers.length > 0 && !readonlyBindings.includes(target);
    });
    const replayWrites = writes.filter((write) => {
      if (runnerOf(module, write.operation) !== fn) return false;
      return computations.some((group) => group.steps.some((root) => {
        return write.operation.start >= root.start && write.operation.end <= root.end;
      }));
    });
    const replayMutations = mutations.filter((write) => {
      if (runnerOf(module, write.operation) !== fn) return false;
      return computations.some((group) => group.steps.some((root) => {
        return write.operation.start >= root.start && write.operation.end <= root.end;
      }));
    });
    const trackedReads = graph.escaping.flatMap((escaping) => escaping.reads.flatMap((read) => {
      if (read.target.binding === null || !local.includes(read.target as BindingNode) || read.reference === null) return [];
      return [{ node: read.reference.node, binding: read.target as BindingNode }];
    }));
    for (const binding of local) {
      for (const reference of binding.binding.references) {
        if (reference.isWrite || reference.inTypePosition) continue;
        if (![...module.ancestors(reference.node)].some((ancestor) => lexicalBlocks.has(ancestor as Extract<Node, { type: 'BlockStatement' }>))) continue;
        if (!trackedReads.some((read) => read.node === reference.node)) trackedReads.push({ node: reference.node, binding });
      }
    }
    const mutationRoots = local.filter((binding) => {
      const declarator = variableDeclaration(binding.binding);
      if (declarator === null) return false;
      const declaration = module.parentOf(declarator);
      return declaration !== null && module.parentOf(declaration) === fn.body;
    });
    plans.set(fn, {
      ...component, state: local, writes, replayWrites, mutations, replayMutations,
      readonlyBindings, takeovers, siteInputs, memos: computations, trackedReads, dynamicSites, mutationRoots,
    });
  }

  // Markup that no planned component returns belongs to a later phase.
  for (const jsx of module.findAll(['JSXElement', 'JSXFragment'])) {
    const owner = runnerOf(module, jsx);
    const plan = owner === null ? undefined : plans.get(owner);
    if (plan === undefined) unsupported(context, jsx, 'markup outside a component', 6);
  }
  const sharedOwners: SharedOwnerPlan[] = [];
  const shared = [...sharedReads.keys()].filter((binding) => binding.binding.module === module);
  for (const owner of new Set(shared.map(storageOwner))) {
    if (owner !== null && !is.BlockStatement(owner) && (!is.Function(owner) || !is.BlockStatement(owner.body))) continue;
    const bindings = shared.filter((binding) => storageOwner(binding) === owner);
    const computations = (memos.get(owner) ?? []).filter((group) => group.computations[0]!.targets[0]!.binding.module === module)
      .map((group) => ({ ...group, dynamic: true }));
    const targets = computations.flatMap((group) => group.computations.flatMap((memo) => memo.targets));
    const local = [...new Set([...bindings, ...targets])];
    const writes = planWrites(local);
    const mutations = planMutations(local);
    const runner = bindings[0]!.owner.runner;
    const replayed = (operation: Node) => runnerOf(module, operation) === runner
      && computations.some((group) => group.steps.some((root) => operation.start >= root.start && operation.end <= root.end));
    const readonlyBindings = planReadonlyBindings(local);
    sharedOwners.push({
      fn: runner as SharedOwnerPlan['fn'], block: is.BlockStatement(owner) ? owner : null, state: local,
      setup: owner === null ? sharedSetup(module.ast.body, new Set(computations.flatMap((group) => group.computations.map((memo) => memo.declarator))))
        : (is.BlockStatement(owner) ? owner.body : (owner.body as Extract<Node, { type: 'BlockStatement' }>).body) as Statement[],
      memos: computations, writes, mutations,
      replayWrites: writes.filter((write) => replayed(write.operation)),
      replayMutations: mutations.filter((write) => replayed(write.operation)), readonlyBindings,
      takeovers: targets.filter((target) => target.takeovers.length > 0 && !readonlyBindings.includes(target)),
    });
  }
  return { module: entry, components: plans, sharedOwners, sharedReads, receiverTargets: planReceiverTargets(module) };
}

function planComponent(fn: FunctionNode, context: TemplateContext) {
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
