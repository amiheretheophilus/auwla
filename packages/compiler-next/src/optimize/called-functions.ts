/**
 * A component's `const run = () => { … }` that is only called (`run()`) or
 * installed as an intrinsic element's listener (`onClick={run}`) is a constant
 * no output can observe beyond its identity: nothing reassigns it, and no
 * reference lets code reach the function object to edit its properties. It
 * needs no version, mutation root, tracked read or site update; the component
 * compiles it as it compiles `onClick={() => { … }}`.
 */
import { is } from 'yuku-ast';
import type { Binding } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../core/graph';
import type { ComponentPlan, ModulePlan, Site } from '../core/plan';
import { unwrap } from '../core/plan/jsx';
import type { Optimization } from '.';

/** Every intrinsic event site's value, in components, branches and stored JSX. */
function eventValues(plan: ModulePlan): ReadonlySet<Node> {
  const values = new Set<Node>();
  const visit = (sites: readonly Site[]): void => {
    for (const site of sites) {
      if (site.kind === 'event') values.add(unwrap(site.expression));
      if (site.kind === 'conditional') for (const branch of site.branches) visit(branch.sites);
    }
  };
  for (const component of plan.components.values()) visit(component.sites);
  for (const value of plan.values) visit(value.sites);
  return values;
}

/** The binding holds one unnamed function literal and only calls or listeners reach it. */
function onlyCalled(node: BindingNode, component: ComponentPlan, events: ReadonlySet<Node>): boolean {
  const { binding } = node;
  const module = binding.module;
  if (node.kind === 'Prop' || node.writes.length > 0 || binding.declarations.length !== 1) return false;

  const name = binding.declarations[0]!;
  const declarator = module.parentOf(name);
  const declaration = declarator === null ? null : module.parentOf(declarator);
  if (!is.VariableDeclarator(declarator) || declarator.id !== name || declarator.init === null
    || !is.VariableDeclaration(declaration) || declaration.kind !== 'const') {
    return false;
  }
  // A named function expression can reach itself through its own name.
  const value = unwrap(declarator.init);
  if (!is.ArrowFunctionExpression(value) && !(is.FunctionExpression(value) && value.id === null)) return false;

  if (component.memos.some((group) => group.computations.some((memo) => memo.targets.includes(node)))) return false;

  return binding.references.every((reference) => {
    if (reference.node === name || reference.inTypePosition) return true;
    if (reference.isWrite) return false;
    if (events.has(reference.node)) return true;
    // `run(…)` and `run?.(…)` read only the identity; `new run()` reads its prototype.
    let child: Node = reference.node;
    let parent = module.parentOf(child);
    while (is.ParenthesizedExpression(parent)) {
      child = parent;
      parent = module.parentOf(child);
    }
    return is.CallExpression(parent) && parent.callee === child;
  });
}

export function calledFunctionBindings(plan: ModulePlan): ReadonlySet<Binding> {
  const module = plan.module.module;
  // Dynamic scope can reach any binding by name; source flow has its own storage.
  if (plan.sourceFlow !== undefined || module.findAll('WithStatement').length > 0
    || module.findAll('CallExpression').some((call) => {
      const callee = unwrap(call.callee);
      return is.Identifier(callee) && callee.name === 'eval';
    })) {
    return new Set();
  }
  const events = eventValues(plan);
  const called = new Set<Binding>();
  for (const component of plan.components.values()) {
    for (const node of component.state) {
      if (onlyCalled(node, component, events)) called.add(node.binding);
    }
  }
  return called;
}

export const calledFunctions: Optimization = {
  name: 'called-functions',
  match(general) {
    const called = calledFunctionBindings(general);
    if (called.size === 0) return null;

    const kept = (node: BindingNode) => !called.has(node.binding);
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      if (component.state.every(kept)) continue;
      const siteInputs = new Map([...component.siteInputs].map(([site, inputs]) => [site, inputs.filter(kept)] as const));
      components.set(fn, {
        ...component,
        state: component.state.filter(kept),
        siteInputs,
        trackedReads: component.trackedReads.filter((read) => kept(read.binding)),
        mutationRoots: component.mutationRoots.filter(kept),
        ...(component.keyedComparisons === undefined ? {} : {
          keyedComparisons: new Map([...component.keyedComparisons].filter(([, binding]) => kept(binding))),
        }),
      });
    }
    return { ...general, components };
  },
};
