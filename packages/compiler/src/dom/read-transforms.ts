/** AST transformations used by transparent-source read rewriting. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import { astBindingAt } from '../context';
import { type DomContext as Ctx } from './context';
import { generatedIdentifier, mdd } from './identifiers';
import {annotateAsyncRead} from '../planning/async-reads';
import {
  isBoundTo,
  isEventSourceHolderReference,
  isPassthroughArgument,
  sourceDependencies,
  type TransparentDerivation,
} from '../analysis/transparent-reads';
import { sourceArray, type RenderGatedExpression } from './data-subscriptions';

export function replaceDerivedReads(
  ctx: Ctx,
  root: BaseNode,
  derived: ReadonlyMap<string, TransparentDerivation>,
): void {
  const found: Array<{ identifier: BaseNode; expression: t.Expression }> = [];
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as AstIdentifier).name;
      const projection = derived.get(name);
      if (
        projection === undefined ||
        !isBoundTo(ctx, node, projection.binding)
      ) return;
      found.push({ identifier: node, expression: projection.expression });
      return false;
    },
  });
  for (const { identifier, expression } of found) {
    overwriteNode(
      identifier,
      cloneEstreeNode(expression, true) as unknown as BaseNode,
    );
  }
}

export function trackDependencies(
  ctx: Ctx,
  root: BaseNode,
  tracks: ReadonlyMap<string, readonly string[]>,
  bindings: ReadonlyMap<string, AstBinding>,
  derived: ReadonlyMap<string, TransparentDerivation> = new Map(),
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const sources = tracks.get(name);
    const binding = astBindingAt(ctx, root, name);
    if (sources !== undefined) {
      if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
      for (const source of sources) found.add(source);
      return;
    }
    const projection = derived.get(name);
    if (
      projection?.requestStateOnly === true &&
      isBoundTo(ctx, identifier, projection.binding)
    ) {
      for (const source of projection.sources) found.add(source);
    }
  };
  const atPath = (
    expression: t.CallExpression['arguments'][number] | undefined,
    path: readonly string[],
  ): BaseNode | null => {
    if (
      expression === undefined ||
      expression.type === 'SpreadElement'
    ) return null;
    let current = expression as unknown as BaseNode;
    for (const part of path) {
      if (current.type === 'ObjectExpression') {
        const property = (current as unknown as t.ObjectExpression).properties.find(candidate => {
          if (!astFactory.isObjectProperty(candidate) || candidate.computed) return false;
          return (astFactory.isIdentifier(candidate.key) && candidate.key.name === part) ||
            (astFactory.isStringLiteral(candidate.key) && candidate.key.value === part) ||
            (astFactory.isNumericLiteral(candidate.key) && String(candidate.key.value) === part);
        });
        if (property === undefined || !astFactory.isObjectProperty(property)) return null;
        current = property.value as unknown as BaseNode;
        continue;
      }
      if (current.type === 'ArrayExpression') {
        const index = Number(part);
        if (!Number.isInteger(index) || index < 0) return null;
        const element = (current as unknown as t.ArrayExpression).elements[index];
        if (element === null || element === undefined || element.type === 'SpreadElement') return null;
        current = element as unknown as BaseNode;
        continue;
      }
      return null;
    }
    return current;
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') {
        note(node);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const call = node as unknown as t.CallExpression;
      if (astFactory.isIdentifier(call.callee)) {
        const binding = astBindingAt(
          ctx,
          call.callee as unknown as BaseNode,
          call.callee.name,
        );
        const summary = binding?.kind === 'import'
          ? ctx.importedFunctions.get(call.callee.name)
          : binding?.scope.isProgramScope === true
            ? ctx.helperSummaries.get(call.callee.name)
            : undefined;
        for (const effect of summary?.parameterSourceReads ?? []) {
          const argument = atPath(call.arguments[effect.index], effect.path);
          if (argument?.type !== 'Identifier') continue;
          const binding = bindings.get((argument as unknown as AstIdentifier).name);
          if (binding !== undefined && isBoundTo(ctx, argument, binding)) {
            found.add((argument as unknown as AstIdentifier).name);
          }
        }
      }
      if (
        !astFactory.isIdentifier(call.callee) ||
        !ctx.transparentTrackFactories.has(call.callee.name) ||
        astBindingAt(ctx, node, call.callee.name)?.kind !== 'import'
      ) return;
      const argument = call.arguments[0];
      if (!astFactory.isIdentifier(argument)) return;
      const binding = bindings.get(argument.name);
      if (
        binding !== undefined &&
        isBoundTo(ctx, argument as unknown as BaseNode, binding)
      ) found.add(argument.name);
    },
  });
  return [...found].sort();
}

function replaceSourceReads(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  replacements: ReadonlyMap<string, t.Identifier>,
  eventSources: ReadonlySet<string>,
): void {
  const found: Array<{ identifier: BaseNode; replacement: t.Identifier }> = [];
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as AstIdentifier).name;
      const binding = bindings.get(name);
      const replacement = replacements.get(name);
      if (
        binding === undefined ||
        replacement === undefined ||
        !isBoundTo(ctx, node, binding) ||
        isPassthroughArgument(ctx, node) ||
        isEventSourceHolderReference(ctx, node, eventSources)
      ) {
        return;
      }
      found.push({ identifier: node, replacement });
      return false;
    },
  });
  for (const { identifier, replacement } of found) {
    overwriteNode(
      identifier,
      cloneEstreeNode(replacement) as unknown as BaseNode,
    );
  }
}

/**
 * Render-site semantics for authored control flow: source reads become
 * render-gated (unavailable renders empty, initial failure stays loud) so
 * state-driven branches evaluate immediately while payload sinks self-gate.
 */
export function replaceSourceReadsWithRenderGates(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
): void {
  // Collect first, replace after — the replacement call embeds the same
  // identifier, so replacing during traversal would recurse forever.
  const found: BaseNode[] = [];
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const binding = bindings.get(name);
    if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
    if (isPassthroughArgument(ctx, identifier)) return;
    if (isEventSourceHolderReference(ctx, identifier, eventSources)) return;
    found.push(identifier);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node);
    },
  });
  for (const identifier of found) {
    const name = (identifier as unknown as AstIdentifier).name;
    overwriteNode(
      identifier,
      annotateAsyncRead(astFactory.callExpression(
        mdd(ctx, 'readResolvedValueForRender'),
        [astFactory.identifier(name)],
      ),[name],'undefined',name) as unknown as BaseNode,
    );
  }
}

/**
 * A read inside a render-gated subtree is already availability-safe — unless
 * it sits inside a nested function (handler/effect), where the imperative R2
 * guard still applies.
 */
export function isInsideRenderGate(ctx: Ctx, identifier: BaseNode): boolean {
  let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  while (current !== null) {
    if (
      (current as unknown as RenderGatedExpression).__memoDomRenderGated === true
    ) {
      return true;
    }
    if (
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionExpression' ||
      current.type === 'FunctionDeclaration'
    ) return false;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return false;
}

/** `<Card user={…} />`: the expression container is a component prop's value. */
export function isComponentPropContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (attribute?.type !== 'JSXAttribute') return false;
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (opening?.type !== 'JSXOpeningElement') return false;
  const tag = (opening as unknown as t.JSXOpeningElement).name;
  return astFactory.isJSXIdentifier(tag) && /^[A-Z]/.test(tag.name);
}

export function resolvedRenderExpression(
  ctx: Ctx,
  expression: t.Expression,
  dependencies: readonly string[],
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
  helper = 'readResolvedValuesForRender',
): t.Expression {
  const replacements = new Map<string, t.Identifier>();
  const parameters = dependencies.map((source) => {
    const parameter = generatedIdentifier(ctx, `${source}Value`);
    replacements.set(source, parameter);
    return cloneEstreeNode(parameter);
  });
  replaceSourceReads(
    ctx,
    expression as unknown as BaseNode,
    bindings,
    replacements,
    eventSources,
  );
  const callback = astFactory.arrowFunctionExpression(
    parameters,
    cloneEstreeNode(expression, true),
  );
  ctx.compilerOwnedCallbacks.add(callback);
  return annotateAsyncRead(astFactory.callExpression(mdd(ctx, helper), [
    astFactory.arrayExpression(
      dependencies.map((source) => astFactory.identifier(source)),
    ),
    callback,
  ]),dependencies,'undefined');
}

/**
 * Gate an effect that consumes a loading value: the authored callback first
 * runs once every source it reads has committed, with honest payloads, and may
 * return its cleanup. A mount-time source is recorded on the site, whose entity
 * re-runs on each commit. An event-created holder is absent before its first
 * event and pending immediately after assignment; its slot invalidates the
 * owner again when it settles. Reads of derivations over a source are inlined,
 * so a re-run sees the committed value, not the owner's last replay.
 */
export function gateSourceEffects(
  ctx: Ctx,
  component: string,
  bindings: ReadonlyMap<string, AstBinding>,
  derived: ReadonlyMap<string, TransparentDerivation>,
  eventSources: ReadonlySet<string>,
  refresh: () => void,
): void {
  const emptyDerived = new Map<string, TransparentDerivation>();
  for (const site of ctx.effects.get(component) ?? []) {
    const callback = site.callback;
    if (
      !astFactory.isArrowFunctionExpression(callback) &&
      !astFactory.isFunctionExpression(callback)
    ) continue;
    if (sourceDependencies(ctx, callback as unknown as BaseNode, bindings, derived, eventSources).length === 0) continue;
    replaceDerivedReads(ctx, callback.body as unknown as BaseNode, derived);
    refresh();
    const dependencies = sourceDependencies(
      ctx,
      callback as unknown as BaseNode,
      bindings,
      emptyDerived,
      eventSources,
    );
    if (dependencies.length === 0) continue;
    const mounted = dependencies.filter(source => !eventSources.has(source));
    if (mounted.length > 0) site.transparentSources = mounted;

    const replacements = new Map<string, t.Identifier>();
    const parameters = dependencies.map(source => {
      const parameter = generatedIdentifier(ctx, `${source}EffectValue`);
      replacements.set(source, parameter);
      return cloneEstreeNode(parameter);
    });
    replaceSourceReads(
      ctx,
      callback.body as unknown as BaseNode,
      bindings,
      replacements,
      eventSources,
    );
    const run = astFactory.arrowFunctionExpression(
      parameters,
      cloneEstreeNode(callback.body, true),
    );
    ctx.compilerOwnedCallbacks.add(run);
    const gated = astFactory.arrowFunctionExpression(
      [],
      astFactory.callExpression(mdd(ctx, 'runResolvedValuesEffect'), [
        sourceArray(dependencies),
        run,
      ]),
    );
    ctx.compilerOwnedCallbacks.add(gated);
    site.callback = gated;
  }
}
