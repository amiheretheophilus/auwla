/** Source execution uses the existing component, binding and memo contracts. */
import { findAll, is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import { pending, type BindingNode, type ReadFact, type SemanticGraph } from '../../core/graph';
import { variableDeclaration, type InputQueries } from '../../core/graph/inputs';
import type {
  ComponentPlan,
  ComponentSourcesPlan,
  MemoGroupPlan,
  SourcePrerequisite,
  SourceReadinessGuard,
} from '../../core/plan/model';
import { unsupported, type TemplateContext } from '../../core/plan/template';
import { unwrap } from '../../core/plan/jsx';
import { isParameter, runnerOf, type Module, type ResolvedModule } from '../../core/resolve';
import { dataApi, dataExport, SourceQueries } from './classify';

type PlannedSource = ComponentSourcesPlan['bindings'][number];
type PrerequisitesOf = (root: Node) => SourcePrerequisite[];

export function planSourceMemos(
  memos: readonly MemoGroupPlan[],
  sources: ComponentSourcesPlan,
  graph: SemanticGraph,
  queries: InputQueries,
): readonly MemoGroupPlan[] {
  const bindings = new Set(sources.bindings.map((source) => source.binding));

  return memos.map((group) => {
    const inputs = new Set(group.inputs);
    const computations = group.computations.map((memo) => {
      const source = sources.bindings.find((source) => memo.targets.includes(source.binding));

      if (source === undefined) {
        return memo;
      }

      const requestInputs = new Set<BindingNode>();
      const module = source.binding.binding.module;

      // Payload methods may use other state, but changing that state must not
      // repeat the request which originally supplied the object.
      for (const read of queries.inputsOf(module, source.call).reads) {
        const binding = read.binding ?? read.reference.binding;
        const input = binding === null ? undefined : graph.bindings.get(binding);

        if (input !== undefined && !memo.targets.includes(input)) {
          requestInputs.add(input);
        }
      }

      return { ...memo, initializerInputs: [...requestInputs] };
    });

    // Request settlements arrive outside authored assignments. They must wake
    // this group even when the source is also one of the group's own outputs.
    for (const memo of group.computations) {
      for (const target of memo.targets) {
        if (bindings.has(target)) {
          inputs.add(target);
        }
      }
    }

    return { ...group, inputs: [...inputs], computations };
  });
}

/** Keep unfinished source execution explicit while the general path is built. */
export function validateSourceCalls(
  graph: SemanticGraph,
  entry: ResolvedModule,
  components: ReadonlySet<Node>,
  context: TemplateContext,
): void {
  const module = entry.module;

  for (const opening of module.findAll('JSXOpeningElement')) {
    if (dataExport(module, opening.name) === 'Group') {
      unsupported(context, opening, 'Group policies and preparation', 8);
    }
  }

  for (const call of module.findAll('CallExpression')) {
    if (dataExport(module, call.callee) === 'Group') {
      unsupported(context, call, 'Group policies and preparation', 8);
    }

    const api = dataApi(module, call.callee);

    if (api !== '$fetch' && api !== '$read') {
      continue;
    }

    const owner = runnerOf(module, call);
    const declaration = module.parentOf(call);
    const statement = declaration === null ? null : module.parentOf(declaration);
    const body = statement === null ? null : module.parentOf(statement);

    const isOwnedDeclaration = owner !== null
      && components.has(owner)
      && is.Function(owner)
      && is.VariableDeclarator(declaration)
      && declaration.init === call
      && body === owner.body;

    if (!isOwnedDeclaration) {
      unsupported(context, call, 'module, helper and callback source creation', 8);
    }

    const binding = is.VariableDeclarator(declaration) ? module.bindingOf(declaration.id) : null;
    const source = binding === null ? undefined : graph.bindings.get(binding);

    // An unknown method may produce an action rather than a source. Keep its
    // contract explicit until action validation and opaque request flow land.
    if (source?.kind !== 'Source') {
      unsupported(context, call, 'actions and opaque source request methods', 8);
    }
  }

  for (const reference of module.references) {
    if (reference.inTypePosition || reference.isWrite) {
      continue;
    }

    const api = dataApi(module, reference.node);

    if (api !== '$fetch' && api !== '$read') {
      continue;
    }

    const parent = module.parentOf(reference.node);

    if (is.CallExpression(parent) && parent.callee === reference.node) {
      continue;
    }

    if (is.ExportSpecifier(parent)) {
      continue;
    }

    // A stable local alias still identifies the same framework API. A passed
    // or reassigned factory needs the later runtime path for opaque sources.
    if (is.VariableDeclarator(parent) && is.Identifier(parent.id)) {
      const alias = module.bindingOf(parent.id);

      if (alias !== null && !alias.references.some((use) => use.isWrite)) {
        continue;
      }
    }

    unsupported(context, reference.node, 'escaping source factories', 8);
  }
}

export function planSources(
  graph: SemanticGraph,
  inputs: InputQueries,
  queries: SourceQueries,
  component: ComponentPlan,
  context: TemplateContext,
): ComponentSourcesPlan | undefined {
  const module = component.state[0]?.binding.module;

  if (module === undefined) {
    return undefined;
  }

  const localSources = component.state.filter((binding) => binding.kind === 'Source');

  if (localSources.length === 0) {
    return undefined;
  }

  const bindings = localSources.map((binding) => planSourceBinding(binding, context));

  for (const source of bindings) {
    const declaration = variableDeclaration(source.binding.binding)!;
    const statement = module.parentOf(declaration);

    if (!component.setup.some((entry) => entry === statement)) {
      unsupported(context, declaration, 'conditionally activated source declarations', 8);
    }
  }

  const payloadReads = localSources.flatMap((binding) => {
    return findPayloadReads(binding, component.fn, queries, context);
  });

  const prerequisites = sourcePrerequisites(graph, module, inputs, queries, localSources, context);
  const guards = planReadinessGuards(component, prerequisites, context);

  for (const call of module.findAll('CallExpression')) {
    if (dataApi(module, call.callee) === '$track') {
      const argument = call.arguments[0];
      const binding = argument === undefined ? null : module.bindingOf(argument);
      const target = binding === null ? undefined : graph.bindings.get(binding);

      if (target !== undefined && target.kind !== 'Source' && !isParameter(target.binding)) {
        const declaration = variableDeclaration(target.binding);
        const aliasesHandle = declaration?.init != null && is.Identifier(unwrap(declaration.init));

        if (pending(target).size > 0 || aliasesHandle) {
          unsupported(context, call, 'source handle aliases', 8);
        }
      }

      if (argument !== undefined && !is.Identifier(argument) && prerequisites(argument).length > 0) {
        unsupported(context, call, 'nested source status paths', 8);
      }
    }

    if (!is.Identifier(call.callee, '$effect')) {
      continue;
    }

    if (module.referenceOf(call.callee)?.binding != null || runnerOf(module, call) !== component.fn) {
      continue;
    }

    unsupported(context, call, 'effects in a source owner', 8);
  }

  return { bindings, payloadReads, guards };
}

function planSourceBinding(binding: BindingNode, context: TemplateContext): PlannedSource {
  const declaration = variableDeclaration(binding.binding);
  const initializer = declaration?.init == null ? null : unwrap(declaration.init);

  if (declaration === null || !is.Identifier(declaration.id) || !is.CallExpression(initializer)) {
    unsupported(context, binding.binding.declarations[0]!, 'source factories and source patterns', 8);
  }

  const api = dataApi(binding.binding.module, initializer.callee);

  if (api !== '$fetch' && api !== '$read') {
    unsupported(context, initializer, 'source factories and source patterns', 8);
  }

  if (binding.takeovers.length > 0) {
    unsupported(context, declaration, 'source reassignment', 8);
  }

  return {
    binding,
    call: initializer,
    read: api === '$read',
  };
}

function findPayloadReads(
  binding: BindingNode,
  owner: Node,
  queries: SourceQueries,
  context: TemplateContext,
): Node[] {
  const reads: Node[] = [];
  const module = binding.binding.module;

  for (const reference of binding.binding.references) {
    if (reference.isWrite || reference.inTypePosition) {
      continue;
    }

    const read: ReadFact = { reference };
    const use = queries.readUse(read);

    // Status helpers need the resource handle, including before its first load.
    if (use.handle) {
      if (use.payload) {
        unsupported(context, reference.node, 'mixed source-handle helper parameters', 8);
      }

      continue;
    }

    if (runnerOf(module, reference.node) !== owner) {
      unsupported(context, reference.node, 'source payload captures in callbacks', 8);
    }

    reads.push(reference.node);
  }

  return reads;
}

function sourcePrerequisites(
  graph: SemanticGraph,
  module: Module,
  inputs: InputQueries,
  queries: SourceQueries,
  localSources: readonly BindingNode[],
  context: TemplateContext,
): PrerequisitesOf {
  const sources = new Set(localSources);

  return (root) => {
    const result: SourcePrerequisite[] = [];

    const visit = (
      binding: BindingNode,
      path: ReadonlySet<BindingNode>,
      taken: readonly BindingNode[],
    ): void => {
      if (path.has(binding)) {
        return;
      }

      // A later assignment stops following the binding's initializer. Preserve
      // each path so one overridden alias does not unblock its sibling.
      const unlessTaken = binding.takeovers.length > 0 ? [...taken, binding] : taken;

      if (binding.kind === 'Source') {
        if (!sources.has(binding)) {
          unsupported(context, root, 'shared and forwarded source readiness', 8);
        }

        result.push({ source: binding, unlessTaken });
      }

      const next = new Set(path).add(binding);

      for (const edge of binding.reads) {
        if (edge.readiness === false || edge.target.binding === null) {
          continue;
        }

        visit(edge.target as BindingNode, next, unlessTaken);
      }
    };

    for (const read of inputs.inputsOf(module, root).reads) {
      if (!queries.waitsForPayload(read)) {
        continue;
      }

      const binding = read.binding ?? read.reference.binding;
      const node = binding === null ? undefined : graph.bindings.get(binding);

      if (node !== undefined) {
        visit(node, new Set(), []);
      }
    }

    return result;
  };
}

function planReadinessGuards(
  component: ComponentPlan,
  prerequisites: PrerequisitesOf,
  context: TemplateContext,
): ReadonlyMap<Expression, SourceReadinessGuard> {
  const guards = new Map<Expression, SourceReadinessGuard>();

  const guard = (root: Expression, render = false): void => {
    const pending = prerequisites(root);

    if (pending.length === 0) {
      return;
    }

    // A static wait set cannot decide which branch JavaScript will execute.
    // Keep that work explicitly deferred until lazy source execution is built.
    if (hasLazySourceRead(root, prerequisites)) {
      unsupported(context, root, 'lazy source readiness', 8);
    }

    guards.set(root, { inputs: pending, render });
  };

  for (const group of component.memos) {
    for (const memo of group.computations) {
      if (memo.declarator.init !== null) {
        guard(memo.declarator.init);
      }

      if (!is.Identifier(memo.declarator.id) && prerequisites(memo.declarator).length > 0) {
        unsupported(context, memo.declarator, 'source destructuring', 8);
      }

      for (const builder of memo.builders) {
        if (prerequisites(builder).length > 0) {
          unsupported(context, builder, 'source-dependent body builders', 8);
        }
      }

      for (const [builder, targets] of memo.possibleBuilders) {
        const guardsInitializer = is.VariableDeclarator(builder)
          && component.memos.some((group) => group.computations.some((candidate) => candidate.declarator === builder));

        const onlySourceTargets = targets.every((target) => target.kind === 'Source');

        if (guardsInitializer && onlySourceTargets) {
          continue;
        }

        if (prerequisites(builder).length > 0) {
          unsupported(context, builder, 'source-dependent possible body builders', 8);
        }
      }
    }
  }

  for (const site of component.sites) {
    if (site.kind === 'conditional' && prerequisites(site.expression).length > 0) {
      unsupported(context, site.expression, 'source-dependent return selection', 8);
    }

    if (site.kind !== 'event' && site.kind !== 'ref') {
      guard(site.expression, true);
    }
  }

  for (const jsx of findAll(component.fn.body!, 'JSXElement')) {
    const name = jsx.openingElement.name;

    if (!is.JSXIdentifier(name) || /^[a-z]/.test(name.name)) {
      continue;
    }

    if (prerequisites(jsx).length > 0) {
      unsupported(context, jsx, 'source values in component props', 8);
    }
  }

  return guards;
}

function hasLazySourceRead(root: Node, prerequisites: PrerequisitesOf): boolean {
  const branches = findAll(root, ['ConditionalExpression', 'LogicalExpression']);

  return branches.some((branch) => {
    const test = is.ConditionalExpression(branch) ? branch.test : branch.left;
    const branches = is.ConditionalExpression(branch)
      ? [branch.consequent, branch.alternate]
      : [branch.right];

    // If the test itself needs this source, checking it cannot introduce an
    // additional wait. Only sources confined to a selected branch need laziness.
    const requiredByTest = prerequisites(test);

    return branches.some((selected) => {
      return prerequisites(selected).some((input) => !coveredByTest(input, requiredByTest));
    });
  });
}

function coveredByTest(
  input: SourcePrerequisite,
  testInputs: readonly SourcePrerequisite[],
): boolean {
  return testInputs.some((test) => {
    if (test.source !== input.source) {
      return false;
    }

    // An override may make the test ready while this branch still waits.
    // Comparing source identity alone would incorrectly make that branch eager.
    return test.unlessTaken.every((binding) => input.unlessTaken.includes(binding));
  });
}
