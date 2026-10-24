/**
 * plan: graph → one `ModulePlan` per module (`wiki/compiler/core.md`, "plan").
 *
 * Setup keeps native storage. Phase 4 also plans expression returns and return-only
 * if/else tails as lazy regions, retaining the authored graph and syntax identities.
 */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import { isReactive, type BindingNode, type SemanticGraph } from '../graph';
import { variableDeclaration, type InputQueries } from '../graph/inputs';
import { isWrittenGlobal, runnerOf, type ResolvedModule } from '../resolve';
import type { FunctionNode } from '../resolve/functions';
import type {
  ComponentPlan, MemoGroupPlan, ModulePlan, RenderValuePlan, SharedOwnerPlan,
  SharedReadPlan, Site,
} from './model';
import { buildTemplate, unsupported, type TemplateContext } from './template';
import { unwrap } from './jsx';
import { planLocalState } from '../../features/state/plan';
import { planMutations, planReadonlyBindings, planWrites } from '../../features/handlers/plan';
import { planMemos } from '../../features/derived/plan';
import { planSharedReads, sharedSetup } from '../../features/state/shared-plan';
import { planReceiverTargets } from '../../features/handlers/receivers';
import { storageOwner } from './storage';
import { planReturns } from '../../features/conditionals/returns';
import { rejectLaterPhases } from './later-phases';

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
  const claimed = new Set<Node>();
  const context: TemplateContext = {
    path: entry.path,
    source: module.source,
    reactive: (expression) => readsReactive(graph, queries, entry, expression),
    claimMarkup: (node) => {
      claimed.add(node);
    },
  };
  rejectLaterPhases(entry, context);

  const plans = new Map<Node, ComponentPlan>();
  const moduleBindings = [...sharedReads.keys()].filter((binding) => binding.binding.module === module);
  const lexicalBlocks = new Set(moduleBindings.map(storageOwner).filter(is.BlockStatement));
  for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (!components.has(fn)) {
      continue;
    }
    const computations = memos.get(fn) ?? [];
    const targets = computations.flatMap((group) => group.computations.flatMap((memo) => memo.targets));
    const local = [...new Set([...(state.get(fn) ?? []), ...targets])];
    const component = planComponent(fn, context);
    const { siteInputs, dynamicSites } = planSiteInputs(component.sites, fn, graph, queries, entry);
    const writes = planWrites(local);
    const mutations = planMutations(local);
    const readonlyBindings = planReadonlyBindings(local);
    const takeovers = targets.filter((target) => {
      return target.takeovers.length > 0 && !readonlyBindings.includes(target);
    });
    const replayWrites = writes.filter((write) => {
      if (runnerOf(module, write.operation) !== fn) {
        return false;
      }
      return computations.some((group) => group.steps.some((root) => {
        return write.operation.start >= root.start && write.operation.end <= root.end;
      }));
    });
    const replayMutations = mutations.filter((write) => {
      if (runnerOf(module, write.operation) !== fn) {
        return false;
      }
      return computations.some((group) => group.steps.some((root) => {
        return write.operation.start >= root.start && write.operation.end <= root.end;
      }));
    });
    const trackedReads = graph.escaping.flatMap((escaping) => escaping.reads.flatMap((read) => {
      if (read.target.binding === null || !local.includes(read.target as BindingNode) || read.reference === null) {
        return [];
      }
      return [{ node: read.reference.node, binding: read.target as BindingNode }];
    }));
    for (const binding of local) {
      for (const reference of binding.binding.references) {
        if (reference.isWrite || reference.inTypePosition) {
          continue;
        }
        const insideLexicalBlock = [...module.ancestors(reference.node)].some((ancestor) => {
          return is.BlockStatement(ancestor) && lexicalBlocks.has(ancestor);
        });
        if (!insideLexicalBlock) {
          continue;
        }
        if (!trackedReads.some((read) => read.node === reference.node)) {
          trackedReads.push({ node: reference.node, binding });
        }
      }
    }
    const mutationRoots = local.filter((binding) => {
      const declarator = variableDeclaration(binding.binding);
      if (declarator === null) {
        return false;
      }
      const declaration = module.parentOf(declarator);
      return declaration !== null && module.parentOf(declaration) === fn.body;
    });
    plans.set(fn, {
      ...component,
      state: local,
      writes,
      replayWrites,
      mutations,
      replayMutations,
      readonlyBindings,
      takeovers,
      siteInputs,
      memos: computations,
      trackedReads,
      dynamicSites,
      mutationRoots,
    });
  }

  // Remaining JSX is a native stored/passed/returned value. Capture its site
  // inputs where it is evaluated, retaining lexical scope and evaluation order.
  const values: RenderValuePlan[] = [];
  for (const jsx of module.findAll(['JSXElement', 'JSXFragment'])) {
    if (claimed.has(jsx)) {
      continue;
    }
    const value = buildTemplate(jsx, { ...context, captureValues: true });
    const svg = buildTemplate(jsx, { ...context, captureValues: true }, [], 'svg');
    values.push({ node: jsx, ...value, svgTemplate: { ...svg.template, markup: null } });
  }
  const sharedOwners: SharedOwnerPlan[] = [];
  const shared = moduleBindings;
  for (const owner of new Set(shared.map(storageOwner))) {
    if (owner !== null && !is.BlockStatement(owner) && (!is.Function(owner) || !is.BlockStatement(owner.body))) {
      continue;
    }
    const bindings = shared.filter((binding) => storageOwner(binding) === owner);
    // A shared setup must collect its own executed reads instead of adding them
    // to the component or factory computation that happened to invoke it.
    const computations = (memos.get(owner) ?? []).filter((group) => group.computations[0]!.targets[0]!.binding.module === module)
      .map((group) => ({ ...group, dynamic: true }));
    const targets = computations.flatMap((group) => group.computations.flatMap((memo) => memo.targets));
    const local = [...new Set([...bindings, ...targets])];
    const writes = planWrites(local);
    const mutations = planMutations(local);
    const runner = bindings[0]!.owner.runner;
    const replayed = (operation: Node) => {
      return runnerOf(module, operation) === runner && computations.some((group) => {
        return group.steps.some((root) => operation.start >= root.start && operation.end <= root.end);
      });
    };
    const readonlyBindings = planReadonlyBindings(local);
    let setup: readonly Statement[];
    if (owner === null) {
      const memoDeclarations = computations.flatMap((group) => {
        return group.computations.map((memo) => memo.declarator);
      });
      setup = sharedSetup(module.ast.body, new Set(memoDeclarations));
    } else if (is.BlockStatement(owner)) {
      setup = owner.body as Statement[];
    } else {
      setup = (owner.body as Extract<Node, { type: 'BlockStatement' }>).body as Statement[];
    }

    sharedOwners.push({
      fn: runner as SharedOwnerPlan['fn'],
      block: is.BlockStatement(owner) ? owner : null,
      state: local,
      setup,
      memos: computations,
      writes,
      mutations,
      replayWrites: writes.filter((write) => replayed(write.operation)),
      replayMutations: mutations.filter((write) => replayed(write.operation)),
      readonlyBindings,
      takeovers: targets.filter((target) => target.takeovers.length > 0 && !readonlyBindings.includes(target)),
    });
  }
  return {
    module: entry,
    components: plans,
    sharedOwners,
    sharedReads,
    receiverTargets: planReceiverTargets(module),
    values,
  };
}

function allSites(sites: readonly Site[]): Site[] {
  const result: Site[] = [];
  for (const site of sites) {
    result.push(site);
    if (site.kind === 'conditional') {
      for (const branch of site.branches) {
        result.push(...allSites(branch.sites));
      }
    }
  }
  return result;
}

function planSiteInputs(
  sites: readonly Site[],
  owner: FunctionNode,
  graph: SemanticGraph,
  queries: InputQueries,
  entry: ResolvedModule,
) {
  const siteInputs = new Map<Expression, readonly BindingNode[]>();
  const dynamicSites = new Set<Expression>();

  for (const site of allSites(sites)) {
    const inputs = new Set<BindingNode>();
    // Branch text and attributes have their own guards. Including them here
    // would repeat a selector even when only the selected branch's text changed.
    const expressions = site.kind === 'conditional' ? site.selectorInputs : [site.expression];
    for (const expression of expressions) {
      if (expression.end === 0) {
        continue;
      }
      const facts = queries.inputsOf(entry.module, expression);
      if (facts.opaque) {
        dynamicSites.add(site.expression);
      }
      for (const read of facts.reads) {
        const binding = read.binding ?? read.reference.binding;
        const node = binding === null ? undefined : graph.bindings.get(binding);
        if (node === undefined) {
          continue;
        }
        inputs.add(node);
        if (storageOwner(node) !== owner) {
          dynamicSites.add(site.expression);
        }
      }
    }
    siteInputs.set(site.expression, [...inputs]);
  }
  return { siteInputs, dynamicSites };
}

function planComponent(fn: FunctionNode, context: TemplateContext) {
  const { setup, markup } = splitBody(fn, context);
  const { template, sites } = buildTemplate(markup, context);
  return { fn, setup, template, sites };
}

/** `{ …setup; return <markup />; }`, or an arrow whose body is the markup. */
function splitBody(fn: FunctionNode, context: TemplateContext) {
  type Markup = Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>;
  const body = fn.body;
  if (body === null) {
    return unsupported(context, fn, 'a component without a body', 6);
  }

  if (!is.BlockStatement(body)) {
    return { setup: [] as Statement[], markup: returnedMarkup(body as Expression) };
  }

  const returned = planReturns(body.body as Statement[], (node) => {
    return unsupported(context, node, 'setup statements after a conditional return', 4);
  });
  return { setup: returned.setup, markup: returnedMarkup(returned.expression) };

  function returnedMarkup(expression: Expression): Markup {
    const value = unwrap(expression);
    if (is.JSXElement(value) || is.JSXFragment(value)) {
      return value;
    }
    return b.JSXFragment({
      openingFragment: b.JSXOpeningFragment({}),
      closingFragment: b.JSXClosingFragment({}),
      children: [b.JSXExpressionContainer({ expression })],
    });
  }
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
