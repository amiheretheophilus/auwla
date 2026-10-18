/** Module-source read lowering for transparent data. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  cloneNode as cloneEstreeNode,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import { astBindingAt, nodeHasJsx } from '../context';
import { type DomContext as Ctx } from './context';
import { generatedIdentifier, mdd } from './identifiers';
import {annotateAsyncRead, annotateTransparentSources, transparentExpressionSources} from '../planning/async-reads';
import { initialReadPlacement } from './initial-dom';
import { isComponentPropContainer } from './read-transforms';
import {
  isActionRefreshTarget,
  isBoundTo,
  isEventOrRefContainer,
  isPassthroughArgument,
  stateSeedDeclarators,
} from '../analysis/transparent-reads';
import { isGeneratedDataCall } from './data-read-recognition';

/**
 * Lower reads of module-scope source refs inside a component:
 *   - list receivers (.map)  → _MDD.readModuleSourceList(_ref)
 *   - other render sites     → _MDD.readResolvedValueForRender(_ref)
 *   - imperative statements  → _MDD.readResolvedValue(_ref, name, site)
 * Each emitted read materializes the source into the ACTIVE runtime on first
 * touch (request-local on the server).
 */
interface EstreeModuleSourceEntry {
  name: string;
  key: string;
  binding: AstBinding;
}

export function lowerModuleRefReadsEstree(
  ctx: Ctx,
  componentName: string,
  component: BaseNode,
  refresh: () => void,
): void {
  const entries: EstreeModuleSourceEntry[] = [];
  const program = ctx.astAnalysis?.rootScope.block;
  for (const [name, key] of ctx.transparentModuleSources) {
    const binding = astBindingAt(ctx, component, name);
    // A prop or local that shadows the module source's name is not that source.
    if (binding !== undefined && program !== undefined && astBindingAt(ctx, program, name) === binding) {
      entries.push({ name, key, binding });
    }
  }
  if (entries.length === 0) return;
  ctx.usesTransparentData = true;

  const entryFor = (identifier: BaseNode): EstreeModuleSourceEntry | null => {
    if (identifier.type !== 'Identifier') return null;
    const name = (identifier as unknown as AstIdentifier).name;
    const entry = entries.find((candidate) => candidate.name === name);
    return entry !== undefined && isBoundTo(ctx, identifier, entry.binding)
      ? entry
      : null;
  };
  const refCall = (key: string): t.Expression =>
    astFactory.callExpression(mdd(ctx, 'sourceRef'), [astFactory.stringLiteral(key)]);
  const isListReceiver = (identifier: BaseNode): boolean => {
    const member = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    if (member?.type !== 'MemberExpression') return false;
    const memberNode = member as unknown as t.MemberExpression;
    if (
      memberNode.object !== identifier ||
      memberNode.computed ||
      !astFactory.isIdentifier(memberNode.property, { name: 'map' })
    ) return false;
    return ctx.astAnalysis?.parentByNode.get(member)?.type === 'CallExpression';
  };
  const collect = (root: BaseNode): Array<{
    identifier: BaseNode;
    entry: EstreeModuleSourceEntry;
  }> => {
    const found: Array<{
      identifier: BaseNode;
      entry: EstreeModuleSourceEntry;
    }> = [];
    walkAst(root, {
      enter(node) {
        if (node.type !== 'Identifier') return;
        const entry = entryFor(node);
        if (entry === null || isPassthroughArgument(ctx, node)) return;
        found.push({ identifier: node, entry });
      },
    });
    return found;
  };
  const isJsxNode = (node: BaseNode) =>
    astFactory.isJSXElement(node as unknown as t.Node) || astFactory.isJSXFragment(node as unknown as t.Node);
  const isConditionalJsx = (expression: t.Expression): boolean =>
    (astFactory.isConditionalExpression(expression) || astFactory.isLogicalExpression(expression) &&
      (expression.operator === '&&' || expression.operator === '||')) && nodeHasJsx(expression);
  const collectOutsideJsx = (root: BaseNode) => {
    const found: Array<{ identifier: BaseNode; entry: EstreeModuleSourceEntry }> = [];
    walkAst(root, {
      enter(node) {
        if (isJsxNode(node)) return false;
        if (node.type !== 'Identifier') return;
        const entry = entryFor(node);
        if (entry !== null && !isPassthroughArgument(ctx, node)) found.push({ identifier: node, entry });
      },
    });
    return found;
  };
  /** Test of each `?:` and left side of each `&&`/`||`, through nested conditionals. */
  const conditionOperands = (expression: t.Expression): BaseNode[] => {
    if (astFactory.isConditionalExpression(expression)) {
      return [expression.test as unknown as BaseNode,
        ...conditionOperands(expression.consequent), ...conditionOperands(expression.alternate)];
    }
    if (astFactory.isLogicalExpression(expression) && (expression.operator === '&&' || expression.operator === '||')) {
      return [expression.left as unknown as BaseNode, ...conditionOperands(expression.right)];
    }
    return [];
  };
  /**
   * `operand` → `!resolvedValuesPending([refs]) && operand`, its module reads
   * lowered in place. Only for planned initial content, whose sources have
   * committed before it renders.
   */
  const wrapReads = (operand: BaseNode): void => {
    const reads = collectOutsideJsx(operand);
    if (reads.length === 0) return;
    const unique = [...new Map(reads.map(({ entry }) => [entry.name, entry])).values()];
    for (const { identifier, entry } of reads) replaceRead(identifier, entry, 'readResolvedValueForRender');
    const lowered = cloneEstreeNode(operand, true) as unknown as t.Expression;
    overwriteNode(operand, astFactory.logicalExpression('&&',
      astFactory.unaryExpression('!', annotateAsyncRead(astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        astFactory.arrayExpression(unique.map(entry => refCall(entry.key))),
      ]), unique.map(entry => entry.key), 'undefined')),
      lowered) as unknown as BaseNode);
  };
  /** Module-source reads in a choice, left for read rewriting to gate with the choice's other sources. */
  const choiceReads = new Set<BaseNode>();
  const replaceRead = (
    identifier: BaseNode,
    entry: EstreeModuleSourceEntry,
    helper: 'readModuleSourceList' | 'readResolvedValueForRender',
  ): void => {
    overwriteNode(
      identifier,
      annotateAsyncRead(astFactory.callExpression(
        mdd(ctx, helper),
        [refCall(entry.key)],
      ),[entry.key],helper==='readModuleSourceList'?'empty-list':'undefined',entry.name) as unknown as BaseNode,
    );
  };

  walkAst(component, {
    enter(node) {
      const spread = node.type === 'JSXSpreadAttribute';
      if (node.type !== 'JSXExpressionContainer' && !spread) return;
      if (isEventOrRefContainer(ctx, node)) return false;
      const rawExpression = childNode(node, spread ? 'argument' : 'expression');
      if (
        rawExpression === null ||
        !astFactory.isExpression(rawExpression as unknown as t.Node)
      ) return false;
      const expression = rawExpression as unknown as t.Expression;
      const groupMarked = (
        expression as t.Expression & { __memoDomTransparentGroup?: boolean }
      ).__memoDomTransparentGroup === true;

      if (groupMarked) {
        const committedContainers: BaseNode[] = [];
        walkAst(rawExpression, {
          enter(current) {
            let ancestor = ctx.astAnalysis?.parentByNode.get(current) ?? null;
            let insideFragment = false;
            while (ancestor !== null && ancestor !== rawExpression) {
              if (ancestor.type === 'JSXFragment') {
                insideFragment = true;
                break;
              }
              ancestor = ctx.astAnalysis?.parentByNode.get(ancestor) ?? null;
            }
            if (
              current !== node &&
              current.type === 'JSXExpressionContainer' &&
              insideFragment &&
              !isEventOrRefContainer(ctx, current)
            ) committedContainers.push(current);
          },
        });
        for (const container of committedContainers) {
          const inner = childNode(container, 'expression');
          if (inner === null) continue;
          for (const { identifier, entry } of collect(inner)) {
            replaceRead(
              identifier,
              entry,
              isListReceiver(identifier)
                ? 'readModuleSourceList'
                : 'readResolvedValueForRender',
            );
          }
        }
        refresh();
        return false;
      }

      // `<Card user={me} />`: the component receives the source itself, as it
      // would a local one, and handles pending/error at its own read sites.
      const direct = entryFor(rawExpression);
      if (direct !== null && isComponentPropContainer(ctx, node)) {
        overwriteNode(rawExpression, refCall(direct.key) as unknown as BaseNode);
        refresh();
        return false;
      }

      // A conditional child stays a conditional: only its own operands are
      // lowered here; branch JSX keeps its containers, visited next.
      if (isConditionalJsx(expression)) {
        // `{me === null ? <SignIn/> : <Avatar profile={me}/>}` chooses only once
        // `me` has committed: like a local source, the choice is a read site
        // showing the pending policy, never a branch picked from missing data.
        const conditions = conditionOperands(expression);
        if (initialReadPlacement(ctx, componentName, rawExpression).structural) {
          for (const condition of conditions) wrapReads(condition);
        } else {
          for (const condition of conditions) {
            for (const { identifier } of collectOutsideJsx(condition)) choiceReads.add(identifier);
          }
        }
        for (const { identifier, entry } of collectOutsideJsx(rawExpression)) {
          if (choiceReads.has(identifier)) continue;
          replaceRead(identifier, entry, isListReceiver(identifier) ? 'readModuleSourceList' : 'readResolvedValueForRender');
        }
        annotateTransparentSources(expression, transparentExpressionSources(expression));
        refresh();
        return undefined;
      }

      const referenced = collect(rawExpression);
      if (referenced.length === 0) return undefined;
      for (const { identifier, entry } of referenced) {
        if (isListReceiver(identifier)) {
          replaceRead(identifier, entry, 'readModuleSourceList');
        }
      }
      refresh();
      const remaining = collect(rawExpression);
      if (remaining.length > 0) {
        const direct = entryFor(rawExpression);


        if(initialReadPlacement(ctx,componentName,rawExpression).structural) {
          for(const {identifier,entry} of remaining) replaceRead(identifier,entry,'readResolvedValueForRender');
        } else if (direct !== null) {
          replaceRead(rawExpression, direct, 'readResolvedValueForRender');
        } else {
          const uniqueEntries = [
            ...new Map(
              remaining.map(({ entry }) => [entry.name, entry]),
            ).values(),
          ];
          const replacements = new Map<string, t.Identifier>();
          const parameters = uniqueEntries.map((entry) => {
            const parameter = generatedIdentifier(ctx, `${entry.name}Value`);
            replacements.set(entry.name, parameter);
            return cloneEstreeNode(parameter);
          });
          for (const { identifier, entry } of remaining) {
            overwriteNode(
              identifier,
              cloneEstreeNode(replacements.get(entry.name)!) as unknown as BaseNode,
            );
          }
          const body = cloneEstreeNode(expression, true);
          const callback = astFactory.arrowFunctionExpression(parameters, body);
          ctx.compilerOwnedCallbacks.add(callback);
          overwriteNode(
            rawExpression,
            annotateAsyncRead(astFactory.callExpression(mdd(ctx, 'readResolvedValuesForRender'), [
              astFactory.arrayExpression(uniqueEntries.map((entry) => refCall(entry.key))),
              callback,
            ]),uniqueEntries.map(entry=>entry.key),'undefined') as unknown as BaseNode,
          );
        }
      }
      annotateTransparentSources(
        rawExpression as unknown as t.Expression,
        transparentExpressionSources(
          rawExpression as unknown as t.Expression,
        ),
      );
      refresh();
      return false;
    },
  });

  // Derivation roots, state seeds and effects wait for their sources; read
  // rewriting gates them together with the component's local sources.
  const derivationDeclarations = new Set(
    (ctx.instanceDerivations.get(componentName) ?? [])
      .map((derivation) => derivation.declaration as unknown as BaseNode),
  );
  const seedDeclarators = new Set<BaseNode>(
    stateSeedDeclarators(ctx, componentName, component as unknown as t.FunctionDeclaration)
      .map(declarator => declarator as unknown as BaseNode),
  );
  const effectCallbacks = new Set<BaseNode>(
    (ctx.effects.get(componentName) ?? []).map(site => site.callback as unknown as BaseNode),
  );
  const insideGatedInit = (identifier: BaseNode): boolean => {
    let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    while (current !== null && !current.type.endsWith('Statement')) {
      if (current.type === 'VariableDeclarator') {
        const declaration = ctx.astAnalysis?.parentByNode.get(current) ?? null;
        return seedDeclarators.has(current) || declaration !== null && derivationDeclarations.has(declaration);
      }
      current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
    }
    return false;
  };
  const insideEffect = (identifier: BaseNode): boolean => {
    for (let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null; current !== null;
      current = ctx.astAnalysis?.parentByNode.get(current) ?? null) {
      if (effectCallbacks.has(current)) return true;
    }
    return false;
  };
  const imperative = collect(component).filter(({ identifier }) =>
    !choiceReads.has(identifier) &&
    !insideGatedInit(identifier) &&
    !insideEffect(identifier) &&
    !isActionRefreshTarget(ctx, identifier) &&
    !isGeneratedDataCall(ctx, identifier)
  );
  for (const { identifier, entry } of imperative) {
    const site = identifier.loc === null || identifier.loc === undefined
      ? ctx.moduleId
      : `${ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
    overwriteNode(
      identifier,
      annotateAsyncRead(astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
        refCall(entry.key),
        astFactory.stringLiteral(entry.name),
        astFactory.stringLiteral(site),
      ]),[entry.key],'throw',entry.name) as unknown as BaseNode,
    );
  }
  refresh();
}
