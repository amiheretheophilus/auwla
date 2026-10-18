/** Semantic analysis for transparent-source read rewriting. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  childNodes,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import { astBindingAt } from '../context';
import { type Ctx } from '../context';
import { jsxAttributeName } from '../jsx/attributes';

export interface TransparentDerivation {
  binding: AstBinding;
  sources: readonly string[];
  expression: t.Expression;
  requestStateOnly?: boolean;
}

/**
 * `let` state declared in a component body with an initializer. A source read
 * there seeds the state once the source commits, so the module pass leaves
 * those reads to read rewriting, as it does derivation roots.
 */
export function stateSeedDeclarators(
  ctx: Ctx,
  component: string,
  node: t.FunctionDeclaration,
): t.VariableDeclarator[] {
  const state = ctx.instanceState.get(component);
  if (state === undefined) return [];
  const derivations = new Set<t.Statement>(
    (ctx.instanceDerivations.get(component) ?? []).map(derivation => derivation.declaration));
  return node.body.body.flatMap(statement =>
    astFactory.isVariableDeclaration(statement) && statement.kind === 'let' && !derivations.has(statement)
      ? statement.declarations.filter(declarator =>
          astFactory.isIdentifier(declarator.id) && state.has(declarator.id.name) &&
          declarator.init != null && !astFactory.isFunction(declarator.init))
      : []);
}

export function isBoundTo(
  ctx: Ctx,
  identifier: BaseNode,
  binding: AstBinding,
): boolean {
  if (identifier.type !== 'Identifier') return false;
  const astIdentifier = identifier as unknown as AstIdentifier;
  const resolved = astBindingAt(ctx, identifier, astIdentifier.name);
  return resolved?.identifier === binding.identifier &&
    resolved.references.includes(astIdentifier);
}

export function isEventOrRefContainer(ctx: Ctx, container: BaseNode): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (parent?.type !== 'JSXAttribute') return false;
  const name = jsxAttributeName(
    (parent as unknown as t.JSXAttribute).name,
  );
  return name === 'ref' || /^on[A-Z]/.test(name);
}

function isComponentPropContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (attribute?.type !== 'JSXAttribute') return false;
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (opening?.type !== 'JSXOpeningElement') return false;
  const name = (opening as unknown as t.JSXOpeningElement).name;
  return astFactory.isJSXIdentifier(name) && /^[A-Z]/.test(name.name);
}

export function isDirectSourceComponentProp(
  ctx: Ctx,
  container: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
): boolean {
  if (!isComponentPropContainer(ctx, container)) return false;
  const expression = childNode(container, 'expression');
  if (expression?.type !== 'Identifier') return false;
  const name = (expression as unknown as AstIdentifier).name;
  const binding = bindings.get(name);
  return binding !== undefined && isBoundTo(ctx, expression, binding);
}

export function isWithinDirectSourceComponentProp(
  ctx: Ctx,
  identifier: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
): boolean {
  const container = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (
    container?.type !== 'JSXExpressionContainer' ||
    childNode(container, 'expression') !== identifier
  ) {
    return false;
  }
  return isDirectSourceComponentProp(ctx, container, bindings);
}

export function isGroupDataContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (
    attribute?.type !== 'JSXAttribute' ||
    jsxAttributeName((attribute as unknown as t.JSXAttribute).name) !== 'data'
  ) {
    return false;
  }
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  return (
    opening?.type === 'JSXOpeningElement' &&
    astFactory.isJSXIdentifier(
      (opening as unknown as t.JSXOpeningElement).name,
      { name: 'Group' },
    )
  );
}

export function isWithinGroupData(ctx: Ctx, node: BaseNode): boolean {
  let current = ctx.astAnalysis?.parentByNode.get(node) ?? null;
  while (current !== null && current.type !== 'JSXExpressionContainer') {
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return current !== null && isGroupDataContainer(ctx, current);
}

export function isPassthroughArgument(
  ctx: Ctx,
  identifier: BaseNode,
): boolean {
  if (sourceStateArgument(ctx, identifier)) return true;
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (parent?.type !== 'CallExpression') return false;
  const call = parent as unknown as t.CallExpression;
  if (!call.arguments.includes(identifier as unknown as t.Expression)) return false;
  const root = astFactory.isIdentifier(call.callee) ? call.callee.name : null;
  return root !== null && ctx.transparentSourcePassthroughs.has(root);
}

function staticPropertyName(property: BaseNode): string | null {
  const key = childNode(property, 'key');
  if (key?.type === 'Identifier' && !(property as unknown as t.ObjectProperty).computed) {
    return (key as unknown as AstIdentifier).name;
  }
  if (key?.type === 'StringLiteral' || key?.type === 'NumericLiteral') {
    return String((key as unknown as { value: string | number }).value);
  }
  return null;
}

function sourceArgumentRead(
  ctx: Ctx,
  expression: BaseNode,
  kind: 'state' | 'payload',
): boolean {
  let current = expression;
  const path: string[] = [];
  for (;;) {
    const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
    if (parent === null) return false;
    if (
      (parent.type === 'ObjectProperty' || parent.type === 'Property') &&
      childNode(parent, 'value') === current
    ) {
      const key = staticPropertyName(parent);
      if (key === null) return false;
      path.unshift(key);
      current = parent;
      continue;
    }
    if (parent.type === 'ObjectExpression') {
      current = parent;
      continue;
    }
    if (parent.type === 'ArrayExpression') {
      const index = childNodes(parent, 'elements').indexOf(current);
      if (index < 0) return false;
      path.unshift(String(index));
      current = parent;
      continue;
    }
    if (parent.type !== 'CallExpression') return false;
    const call = parent as unknown as t.CallExpression;
    const index = call.arguments.indexOf(current as unknown as t.Expression);
    if (index < 0 || !astFactory.isIdentifier(call.callee)) return false;
    const binding = astBindingAt(
      ctx,
      call.callee as unknown as BaseNode,
      call.callee.name,
    );
    const summary = binding?.kind === 'import'
      ? ctx.importedFunctions.get(call.callee.name)
      : binding?.scope.isProgramScope === true && ctx.helpers.has(call.callee.name)
        ? ctx.helperSummaries.get(call.callee.name)
        : undefined;
    const effects = kind === 'state'
      ? summary?.parameterSourceReads
      : summary?.parameterPayloadReads;
    return effects?.some(effect => {
      if (
        effect.index !== index ||
        effect.path.length > path.length ||
        !effect.path.every((part, partIndex) => part === path[partIndex])
      ) {
        return false;
      }
      if (effect.path.length === path.length) return true;
      // A holder-state relationship applies to the holders inside an authored
      // array too. Payload relationships stay exact: reading one collection's
      // payload does not imply reading every nested value as a payload.
      return kind === 'state' && path.slice(effect.path.length).every(
        part => /^(?:0|[1-9]\d*)$/.test(part),
      );
    }) === true;
  }
}

/** Whether this source occurrence feeds a helper parameter's request-state read. */
export function sourceStateArgument(ctx: Ctx, expression: BaseNode): boolean {
  return sourceArgumentRead(ctx, expression, 'state');
}

/** Whether this source occurrence feeds a helper parameter's payload read. */
export function sourcePayloadArgument(ctx: Ctx, expression: BaseNode): boolean {
  return sourceArgumentRead(ctx, expression, 'payload');
}

export function isActionRefreshTarget(ctx: Ctx, identifier: BaseNode): boolean {
  let array = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  while (array !== null && array.type !== 'ArrayExpression') {
    array = ctx.astAnalysis?.parentByNode.get(array) ?? null;
  }
  if (array === null) return false;
  const property = ctx.astAnalysis?.parentByNode.get(array) ?? null;
  if (property?.type !== 'ObjectProperty' && property?.type !== 'Property') {
    return false;
  }
  if (childNode(property, 'value') !== array) return false;
  const objectProperty = property as unknown as t.ObjectProperty;
  const key = objectProperty.key;
  return (
    (!objectProperty.computed && astFactory.isIdentifier(key, { name: 'refresh' })) ||
    astFactory.isStringLiteral(key, { value: 'refresh' })
  );
}

export function sourceBindings(
  ctx: Ctx,
  component: BaseNode,
  names: ReadonlySet<string>,
): Map<string, AstBinding> {
  const bindings = new Map<string, AstBinding>();
  for (const name of names) {
    const binding = astBindingAt(ctx, component, name);
    if (binding !== undefined) bindings.set(name, binding);
  }
  return bindings;
}

/**
 * Event-created sources are nullable holders before their first assignment.
 * Writes and existence guards inspect the holder itself; only later property
 * reads consume its resolved payload.
 */
export function isEventSourceHolderReference(
  ctx: Ctx,
  identifier: BaseNode,
  eventSources: ReadonlySet<string>,
): boolean {
  if (
    identifier.type !== 'Identifier' ||
    !eventSources.has((identifier as unknown as AstIdentifier).name)
  ) return false;
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (parent === null) return false;
  if (
    parent.type === 'AssignmentExpression' &&
    childNode(parent, 'left') === identifier
  ) return true;
  if (
    parent.type === 'BinaryExpression' ||
    parent.type === 'LogicalExpression'
  ) {
    const left = childNode(parent, 'left');
    const right = childNode(parent, 'right');
    if (
      parent.type === 'BinaryExpression' &&
      ['==', '!=', '===', '!=='].includes(
        (parent as unknown as t.BinaryExpression).operator,
      )
    ) {
      const other = left === identifier ? right : left;
      if (other !== null && astFactory.isNullLiteral(other as unknown as t.Node)) {
        return true;
      }
    }
    if (parent.type === 'LogicalExpression' && left === identifier) return true;
  }
  if (
    parent.type === 'UnaryExpression' &&
    (parent as unknown as t.UnaryExpression).operator === '!' &&
    childNode(parent, 'argument') === identifier
  ) return true;
  if (
    (parent.type === 'ConditionalExpression' || parent.type === 'IfStatement') &&
    childNode(parent, 'test') === identifier
  ) return true;
  return false;
}

export function sourceDependencies(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  derived: ReadonlyMap<string, TransparentDerivation>,
  eventSources: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const binding = bindings.get(name);
    if (binding !== undefined && isBoundTo(ctx, identifier, binding)) {
      if (
        !isPassthroughArgument(ctx, identifier) &&
        !isEventSourceHolderReference(ctx, identifier, eventSources)
      ) {
        found.add(name);
      }
      return;
    }
    const derivation = derived.get(name);
    if (
      derivation !== undefined &&
      isBoundTo(ctx, identifier, derivation.binding)
    ) {
      if (derivation.requestStateOnly === true) return;
      for (const source of derivation.sources) found.add(source);
    }
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node);
    },
  });
  return [...found].sort();
}
