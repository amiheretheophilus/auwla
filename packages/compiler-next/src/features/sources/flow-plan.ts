/** Readiness follows authored control flow, using the shared dependency queries. */
import { findAll, is, walk } from 'yuku-ast';
import type { Expression, Node, Statement, VariableDeclarator } from 'yuku-parser';
import type { SemanticGraph } from '../../core/graph';
import type { InputQueries } from '../../core/graph/inputs';
import type { SourceBranchInputs, SourceBuilderPlan, SourceFlowPlan, SourceInputPlan } from '../../core/plan/model';
import type { BindingNode } from '../../core/graph';
import { intrinsicTag, unwrap } from '../../core/plan/jsx';
import { isParameter, runnerOf, type Module, type ResolvedModule } from '../../core/resolve';
import { functionValue } from '../../core/resolve/functions';
import { dataApi, dataExport, SourceQueries } from './classify';

const EMPTY_INPUTS: SourceInputPlan = { reads: [], branches: [] };

export function hasSourceFlow(graph: SemanticGraph): boolean {
  return graph.resolved.modules.some(({ module }) => module.imports.some((imported) => {
    return !imported.typeOnly && imported.specifier.startsWith('@memoized-dom/data');
  }));
}

export function planSourceFlow(
  entry: ResolvedModule,
  graph: SemanticGraph,
  queries: InputQueries,
  components: ReadonlySet<Node>,
  sources: SourceQueries,
): SourceFlowPlan | undefined {
  if (!hasSourceFlow(graph)) {
    return undefined;
  }

  const module = entry.module;
  const payloadReads: Node[] = [];
  const memberObjects: Expression[] = [];
  const guards = new Map<Expression, SourceInputPlan>();
  const retained = new Map<Expression, SourceInputPlan>();
  const patterns = new Map<VariableDeclarator, SourceInputPlan>();
  const groups = module.findAll('JSXElement').filter((element) => {
    return dataExport(module, element.openingElement.name) === 'Group';
  });

  const calls = module.findAll('CallExpression').flatMap((call) => {
    const api = dataApi(module, call.callee);

    return api === '$read' || api === '$fetch' ? [{ call, read: api === '$read' }] : [];
  });

  const moduleSources: { declaration: VariableDeclarator; call: Expression }[] = [];
  const suspends = new Map<Extract<Node, { type: 'JSXElement' }>, readonly Node[]>();

  for (const element of module.findAll('JSXElement')) {
    const suspended = element.openingElement.attributes.some((attribute) => {
      return is.JSXAttribute(attribute) && is.JSXIdentifier(attribute.name) && attribute.name.name === 'suspend';
    });

    if (suspended) {
      suspends.set(element, suspensionInputs(module, element, queries));
    }
  }

  const inputPlan = (root: Node): SourceInputPlan => planInputs(module, root, queries, sources);
  const elements = new Map<Extract<Node, { type: 'JSXElement' }>, SourceInputPlan>();
  const builders = new Map<Node, SourceBuilderPlan>();
  const callbackStatements = new Map<Statement, SourceInputPlan>();
  const bindingBuilders = new Map<BindingNode, Node[]>();

  for (const binding of graph.bindings.values()) {
    if (binding.binding.module !== module) {
      continue;
    }

    for (const builder of binding.initial?.builders ?? []) {
      const statement = is.ExportNamedDeclaration(builder.statement) ? builder.statement.declaration : builder.statement;

      // `Math.max(count, items.length)` passes only a member of `items`: it is
      // observed as a builder, but `items` does not wait for it (`BodyBuilder.waits`).
      if (statement === null || !builder.waits) {
        continue;
      }

      const steps = is.VariableDeclaration(statement) ? statement.declarations : [statement];

      for (const step of steps) {
        const expression = is.VariableDeclarator(step) ? step.init : step;

        if (expression === null || containsSuspension(expression)) {
          continue;
        }

        const owner = runnerOf(module, step);
        const returns = findAll(step, 'ReturnStatement').some((returned) => runnerOf(module, returned) === owner);
        const inputs = inputPlan(expression);

        if (returns) {
          continue;
        }

        const previous = builders.get(step);
        const targets = [...new Set([...(previous?.targets ?? []), binding])];
        const definite = builder.certainty === 'definite'
          ? [...new Set([...(previous?.definite ?? []), binding])]
          : previous?.definite ?? [];

        builders.set(step, { inputs, targets, definite, owner });

        const owned = bindingBuilders.get(binding) ?? [];

        if (!owned.includes(step)) {
          owned.push(step);
        }

        bindingBuilders.set(binding, owned);
      }
    }
  }
  const guard = (root: Expression): void => {
    if (is.Function(unwrap(root)) || is.JSXElement(root) || is.JSXFragment(root) || containsSuspension(root)) {
      return;
    }

    const inputs = inputPlan(root);

    guards.set(root, inputs);
  };

  for (const declaration of module.findAll('VariableDeclarator')) {
    if (declaration.init === null || is.Function(unwrap(declaration.init))) {
      continue;
    }

    const owner = runnerOf(module, declaration);
    const source = sources.sourceValue(module, declaration.init);

    if (source !== null && owner === null) {
      moduleSources.push({ declaration, call: declaration.init });
    }

    if (source !== null && owner !== null && components.has(owner) && !is.Identifier(unwrap(declaration.init))) {
      retained.set(declaration.init, inputPlan(declaration.init));
    }

    if (!is.Identifier(declaration.id)) {
      patterns.set(declaration, inputPlan(declaration.init));
      guard(declaration.init);
      continue;
    }

    // An alias forwards the same handle. Its eventual payload use determines
    // readiness; assigning it must not prematurely turn it into plain data.
    if (is.Identifier(unwrap(declaration.init)) && source !== null) {
      continue;
    }

    if (owner !== null || source === null) {
      guard(declaration.init);
    }
  }

  for (const returned of module.findAll('ReturnStatement')) {
    const owner = runnerOf(module, returned);

    if (owner === null || !is.Function(owner) || components.has(owner) || owner.async || owner.generator) {
      continue;
    }

    if (returned.argument !== null && !containsSuspension(returned.argument)) {
      guard(returned.argument);
    }
  }

  for (const fn of module.findAll('ArrowFunctionExpression')) {
    if (!is.BlockStatement(fn.body) && !components.has(fn) && !fn.async) {
      guard(fn.body);
    }
  }

  for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (components.has(fn) || !is.BlockStatement(fn.body)) {
      continue;
    }

    for (const statement of fn.body.body) {
      if (builders.has(statement) || is.VariableDeclaration(statement) || is.ReturnStatement(statement)
        || is.FunctionDeclaration(statement) || containsSuspension(statement)) {
        continue;
      }

      if (findAll(statement, 'ReturnStatement').some((returned) => runnerOf(module, returned) === fn)) {
        continue;
      }

      const inputs = inputPlan(statement);

      if (inputs.reads.length > 0 || inputs.branches.length > 0) {
        callbackStatements.set(statement as Statement, inputs);
      }
    }
  }

  for (const branch of module.findAll(['IfStatement', 'ConditionalExpression', 'LogicalExpression'])) {
    const owner = runnerOf(module, branch);
    const selectsReturn = is.IfStatement(branch) && owner !== null && components.has(owner)
      && findAll(branch, 'ReturnStatement').some((returned) => runnerOf(module, returned) === owner);
    const selectsMarkup = !is.IfStatement(branch) && findAll(branch, ['JSXElement', 'JSXFragment']).length > 0;

    if (selectsReturn || selectsMarkup) {
      guard(is.LogicalExpression(branch) ? branch.left : branch.test);
    }
  }

  for (const container of module.findAll('JSXExpressionContainer')) {
    const parent = module.parentOf(container);

    if (is.JSXEmptyExpression(container.expression)) {
      continue;
    }

    if (is.JSXAttribute(parent) && is.JSXIdentifier(parent.name)
      && ['pending', 'error', 'suspend'].includes(parent.name.name)) {
      continue;
    }

    if (is.JSXAttribute(parent)) {
      const opening = module.parentOf(parent);
      const element = opening === null ? null : module.parentOf(opening);
      const forwarded = is.JSXElement(element) && intrinsicTag(element) === null
        && !(is.JSXIdentifier(parent.name) && parent.name.name === 'key');

      if (forwarded && is.Identifier(container.expression)) {
        continue;
      }

      if (forwarded && is.MemberExpression(container.expression)) {
        guards.set(container.expression, inputPlan(container.expression.object));
        continue;
      }
    }

    guard(container.expression);
  }

  for (const element of module.findAll('JSXElement')) {
    if (groups.includes(element)) {
      continue;
    }

    const intrinsic = intrinsicTag(element);
    const dynamicAttribute = element.openingElement.attributes.some((attribute) => {
      return is.JSXSpreadAttribute(attribute) || (is.JSXAttribute(attribute)
        && is.JSXExpressionContainer(attribute.value));
    });

    if (intrinsic === null || dynamicAttribute) {
      const parts = intrinsic === null ? [inputPlan(element.openingElement.name)] : [];

      for (const attribute of element.openingElement.attributes) {
        if (is.JSXSpreadAttribute(attribute)) {
          parts.push(inputPlan(attribute.argument));
        }
      }

      elements.set(element, {
        reads: parts.flatMap((part) => part.reads),
        branches: parts.flatMap((part) => part.branches),
      });
    }
  }

  for (const reference of module.references) {
    if (reference.isWrite || reference.inTypePosition || reference.binding === null) {
      continue;
    }

    const parent = module.parentOf(reference.node);

    if (is.ExportSpecifier(parent) || is.JSXOpeningElement(parent) || is.JSXClosingElement(parent)
      || is.JSXMemberExpression(parent) || dataExport(module, reference.node) !== null) {
      continue;
    }

    const use = sources.readUse({ reference });

    if (use.handle || forwardsValue(module, reference.node, components, sources)) {
      continue;
    }

    payloadReads.push(reference.node);
  }

  for (const member of module.findAll('MemberExpression')) {
    if (!is.Super(member.object)) {
      memberObjects.push(member.object);
    }
  }

  return { payloadReads, memberObjects, guards, patterns, groups, calls, moduleSources, retained, suspends, builders, bindingBuilders, callbackStatements, elements };
}

function suspensionInputs(module: Module, root: Node, queries: InputQueries): Node[] {
  const reads: Node[] = [];
  const seen = new Set<object>();
  const visited = new Set<Node>();

  const visit = (part: Node): void => {
    if (visited.has(part)) {
      return;
    }

    visited.add(part);

    for (const read of queries.inputsOf(module, part).reads) {
      const binding = read.binding ?? read.reference.binding;

      if (binding === null || read.reference.module !== module || seen.has(binding)) {
        continue;
      }

      const scope = binding.scope.node;

      if (!is.Program(scope) && (root.start < scope.start || root.end > scope.end)) {
        continue;
      }

      if (binding.declarations.some((name) => name.start >= root.start && name.end <= root.end)) {
        continue;
      }

      seen.add(binding);
      reads.push(read.reference.node);
    }

    for (const opening of findAll(part, 'JSXOpeningElement')) {
      const component = functionValue(module, opening.name);

      if (component?.body != null) {
        visit(component.body);
      }
    }
  };

  visit(root);

  return reads;
}

function forwardsValue(module: Module, value: Node, components: ReadonlySet<Node>, sources: SourceQueries): boolean {
  let parent = module.parentOf(value);

  while (parent !== null && (is.ParenthesizedExpression(parent) || is.TSAsExpression(parent))) {
    value = parent;
    parent = module.parentOf(parent);
  }

  if (is.VariableDeclarator(parent) && parent.init === value) {
    return !is.Identifier(parent.id) || sources.sourceValue(module, value) !== null;
  }

  if (is.JSXExpressionContainer(parent) && is.JSXAttribute(module.parentOf(parent))) {
    const attribute = module.parentOf(parent)!;
    const opening = module.parentOf(attribute);
    const element = opening === null ? null : module.parentOf(opening);

    return is.JSXElement(element) && intrinsicTag(element) === null
      && !(is.JSXAttribute(attribute) && is.JSXIdentifier(attribute.name) && attribute.name.name === 'key')
      && (is.Identifier(value) || is.MemberExpression(value));
  }

  if (is.ReturnStatement(parent) && parent.argument === value) {
    const owner = runnerOf(module, parent);

    return owner !== null && !components.has(owner) && sources.sourceValue(module, value) !== null;
  }

  return false;
}

function containsSuspension(root: Node): boolean {
  let suspends = false;

  walk(root, { enter(node, context) {
    if (is.Function(node)) {
      context.skip();
    } else if (is.AwaitExpression(node) || is.YieldExpression(node)) {
      suspends = true;
      context.stop();
    }
  } });

  return suspends;
}

function planInputs(module: Module, root: Node, queries: InputQueries, sources: SourceQueries): SourceInputPlan {
  const branches: Node[] = [];
  const views: Node[] = [];

  walk(root, { enter(node, context) {
    if (is.JSXElement(node) || is.JSXFragment(node)) {
      views.push(node);
      context.skip();
    } else if (is.Function(node)) {
      context.skip();
    } else if (is.ConditionalExpression(node) || is.LogicalExpression(node)
      || is.IfStatement(node) || is.SwitchStatement(node)) {
      branches.push(node);
      context.skip();
    } else if (is.ForStatement(node) || is.ForOfStatement(node) || is.ForInStatement(node)
      || is.WhileStatement(node) || is.DoWhileStatement(node)) {
      // Different iterations can choose different paths. A loop waits for all
      // sources it might consume, instead of selecting one branch in advance.
      context.skip();
    }
  } });

  const excluded = [...branches, ...views];
  const seen = new Map<object, Set<string>>();
  const reads: SourceInputPlan['reads'][number][] = [];

  for (const read of queries.inputsOf(module, root).reads) {
    const { reference } = read;
    const binding = read.binding ?? reference.binding;
    const position = reference.node;

    if (binding === null || reference.module !== module) {
      continue;
    }

    const scope = binding.scope.node;
    const inScope = is.Program(scope) || (root.start >= scope.start && root.end <= scope.end);
    const declaredWithin = binding.declarations.some((node) => node.start >= root.start && node.end <= root.end);
    const insideExcluded = excluded.some((node) => position.start >= node.start && position.end <= node.end);

    if (!inScope || declaredWithin || insideExcluded) {
      continue;
    }

    const use = sources.readUse(read);
    const path = read.path?.filter((key): key is string => key !== null) ?? [];

    // Parameter paths can contain a resource even when the parameter itself
    // is a plain props object. Data descriptors avoid speculative getters.
    const needsPath = path.length > 0 && isParameter(binding);
    const signature = JSON.stringify([!use.payload, needsPath ? path : []]);
    const uses = seen.get(binding) ?? new Set<string>();

    if (uses.has(signature)) {
      continue;
    }

    reads.push({ value: reference.node, status: !use.payload, path: needsPath ? path : [] });
    uses.add(signature);
    seen.set(binding, uses);
  }

  return {
    reads,
    branches: branches.map((branch): SourceBranchInputs => {
      if (is.SwitchStatement(branch)) {
        return {
          kind: 'switch',
          test: branch.discriminant,
          testInputs: planInputs(module, branch.discriminant, queries, sources),
          cases: branch.cases.map((entry) => ({
            test: entry.test,
            testInputs: entry.test === null ? EMPTY_INPUTS : planInputs(module, entry.test, queries, sources),
            body: planInputs(module, entry, queries, sources),
            ends: endsCase(entry.consequent),
          })),
        };
      }

      const logical = is.LogicalExpression(branch);
      const test = logical ? branch.left : (branch as Extract<Node, { type: 'IfStatement' | 'ConditionalExpression' }>).test;
      const consequent = logical ? branch.right : (branch as Extract<Node, { type: 'IfStatement' | 'ConditionalExpression' }>).consequent;
      const alternate = logical ? null : (branch as Extract<Node, { type: 'IfStatement' | 'ConditionalExpression' }>).alternate;

      return {
        kind: 'branch',
        operator: logical ? branch.operator : '?',
        test,
        testInputs: planInputs(module, test, queries, sources),
        consequent: planInputs(module, consequent, queries, sources),
        alternate: alternate === null ? EMPTY_INPUTS : planInputs(module, alternate, queries, sources),
      };
    }),
  };
}

function endsCase(statements: readonly Node[]): boolean {
  const last = statements.at(-1);

  if (is.BlockStatement(last)) {
    return endsCase(last.body);
  }

  return last !== undefined && (is.BreakStatement(last) || is.ReturnStatement(last)
    || is.ThrowStatement(last) || is.ContinueStatement(last));
}
