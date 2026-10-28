/** Primitive storage cannot own mutable aliases or need a child-value region. */
import { is } from 'yuku-ast';
import type { Binding } from 'yuku-analyzer';
import type { Expression } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../core/graph';
import type { ModulePlan, Site } from '../core/plan';
import { unwrap } from '../core/plan/jsx';
import { alwaysPrimitive } from '../core/plan/template';
import type { Optimization } from '.';

/** Every admitted initializer and successful store has a primitive result. */
function staysPrimitive(node: BindingNode): boolean {
  const { binding } = node;
  const module = binding.module;

  if (node.kind !== 'Constant' && node.kind !== 'State' && node.kind !== 'Derived') {
    return false;
  }

  // Parameter patterns, imports, var redeclarations and implicit loop values
  // need different proofs. Type annotations never establish a runtime type.
  if (binding.declarations.length !== 1) {
    return false;
  }

  const name = binding.declarations[0]!;
  const declarator = module.parentOf(name);
  const declaration = declarator === null ? null : module.parentOf(declarator);

  if (!is.VariableDeclarator(declarator) || declarator.id !== name || !is.Identifier(name)
    || !is.VariableDeclaration(declaration) || (declaration.kind !== 'let' && declaration.kind !== 'const')) {
    return false;
  }

  const parent = module.parentOf(declaration);

  if (is.ForOfStatement(parent) || is.ForInStatement(parent)) {
    return false;
  }

  if (declarator.init !== null && !alwaysPrimitive(declarator.init)) {
    return false;
  }

  for (const { site } of node.writes) {
    if (site.kind !== 'assign' && site.kind !== 'update') {
      // A primitive passed to a call or used as a member receiver cannot
      // become an object through that operation. Keep its observation intact.
      continue;
    }

    const operation = site.node;
    let target: Expression | null = null;

    if (is.AssignmentExpression(operation)) {
      if (is.ArrayPattern(operation.left) || is.ObjectPattern(operation.left)) {
        return false;
      }

      target = unwrap(operation.left);
    } else if (is.UpdateExpression(operation)) {
      target = unwrap(operation.argument);
    }

    if (!is.Identifier(target) || module.referenceOf(target)?.binding !== binding) {
      return false;
    }

    if (is.UpdateExpression(operation)) {
      continue;
    }

    if (!is.AssignmentExpression(operation)) {
      return false;
    }

    // Arithmetic/bitwise assignments always store primitives if they finish.
    // Plain and logical assignments can store their RHS unchanged.
    if ((operation.operator === '=' || operation.operator === '&&='
      || operation.operator === '||=' || operation.operator === '??=')
      && !alwaysPrimitive(operation.right)) {
      return false;
    }
  }

  return true;
}

/** Local component bindings only; source readiness and dynamic scope stay general. */
export function primitiveBindings(plan: ModulePlan, graph: SemanticGraph): ReadonlySet<Binding> {
  const module = plan.module.module;

  if (plan.sourceFlow !== undefined || module.findAll('WithStatement').length > 0
    || module.findAll('CallExpression').some((call) => {
      const callee = unwrap(call.callee);
      return is.Identifier(callee) && callee.name === 'eval';
    })) {
    return new Set();
  }

  const primitives = new Set<Binding>();

  for (const binding of module.bindings) {
    const node = graph.bindings.get(binding);

    if (node !== undefined && node.owner.runner !== null
      && plan.components.has(node.owner.runner) && staysPrimitive(node)) {
      primitives.add(binding);
    }
  }

  return primitives;
}

export const primitiveValues: Optimization = {
  name: 'primitive-values',
  match(general, graph) {
    const primitives = primitiveBindings(general, graph);

    if (primitives.size === 0) {
      return null;
    }

    const module = general.module.module;
    const proven = (identifier: Extract<Site['expression'], { type: 'Identifier' }>): boolean => {
      const binding = module.referenceOf(identifier)?.binding;
      return binding != null && primitives.has(binding);
    };
    const specialize = (sites: readonly Site[]): readonly Site[] => {
      let changed = false;
      const next = sites.map((site): Site => {
        if (site.kind === 'text' && !site.primitive && !site.spread && alwaysPrimitive(site.expression, proven)) {
          changed = true;
          return { ...site, primitive: true, guardDisposal: true };
        }

        if (site.kind !== 'conditional') {
          return site;
        }

        const branches = site.branches.map((branch) => {
          const nested = specialize(branch.sites);

          if (nested === branch.sites) {
            return branch;
          }

          changed = true;
          return { ...branch, sites: nested };
        });

        return branches.some((branch, index) => branch !== site.branches[index])
          ? { ...site, branches }
          : site;
      });

      return changed ? next : sites;
    };

    let changed = false;
    const components = new Map(general.components);

    for (const [fn, component] of general.components) {
      const sites = specialize(component.sites);
      const mutationRoots = component.mutationRoots.filter((node) => !primitives.has(node.binding));

      if (sites !== component.sites || mutationRoots.length !== component.mutationRoots.length) {
        changed = true;
        components.set(fn, { ...component, sites, mutationRoots });
      }
    }

    const values = general.values.map((value) => {
      const sites = specialize(value.sites);

      if (sites === value.sites) {
        return value;
      }

      changed = true;
      return { ...value, sites };
    });

    return changed ? { ...general, components, values } : null;
  },
};
