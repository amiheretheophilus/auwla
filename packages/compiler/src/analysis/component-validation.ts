/** Validates component JSX structure and records composition edges. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import {
  attrExpr,
  nodeHasJsx,
  type Ctx,
} from '../context';
import { containsJsx, matchMapCall } from '../lists';
import {
  isRenderCallbackJsxRoot,
  matchRenderCallbackMap,
} from '../components/render-callbacks';

function isRenderAttributeContainer(ctx: Ctx, container: BaseNode): boolean {
  if (container.type !== 'JSXExpressionContainer') return false;
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (attribute?.type !== 'JSXAttribute') return false;
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (opening?.type !== 'JSXOpeningElement') return false;
  const openingNode = opening as unknown as t.JSXOpeningElement;
  const tag = openingNode.name;
  if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return false;
  const name = (attribute as unknown as t.JSXAttribute).name;
  const attrName = astFactory.isJSXIdentifier(name) ? name.name : name.name.name;
  return (
    ctx.componentProps.get(tag.name)?.renderProps.includes(attrName) === true
  );
}

const LOOP_TYPES = new Set([
  'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement',
]);
const COLLECTING_METHODS = new Set(['push', 'unshift', 'splice']);

/**
 * JSX collected into an array by a loop or push() is created once during
 * setup and never re-run. Name that shape instead of reporting its symptoms
 * (a misplaced key, or leftover JSX) so authors reach for `.map()`.
 */
function isImperativeJsx(ctx: Ctx, element: BaseNode): boolean {
  let child = element;
  let parent = ctx.astAnalysis?.parentByNode.get(element) ?? null;
  while (parent !== null) {
    if (parent.type === 'JSXElement' || parent.type === 'JSXFragment' ||
        parent.type === 'JSXExpressionContainer' || parent.type === 'ReturnStatement' ||
        astFactory.isFunction(parent)) return false;
    if (LOOP_TYPES.has(parent.type)) return true;
    if (parent.type === 'CallExpression') {
      const call = parent as unknown as t.CallExpression;
      if ((call.arguments as readonly BaseNode[]).includes(child) &&
          astFactory.isMemberExpression(call.callee) && !call.callee.computed &&
          astFactory.isIdentifier(call.callee.property) &&
          COLLECTING_METHODS.has(call.callee.property.name)) return true;
    }
    child = parent;
    parent = ctx.astAnalysis?.parentByNode.get(parent) ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------
// pass 1
// ---------------------------------------------------------------------

export function analyzeComponent(ctx: Ctx, name: string): void {
  const p = ctx.compPaths.get(name)!;
  const info = ctx.comps.get(name)!;
  const fail = (message: string, at?: t.Node): never => {
    throw p.buildCodeFrameError(message, at);
  };
  const checkMapCall = (call: BaseNode): boolean => {
    const mapCall = matchMapCall(
      call as unknown as t.CallExpression | t.OptionalCallExpression,
    );
    if (
      mapCall &&
      (containsJsx(call) ||
        matchRenderCallbackMap(ctx, name, mapCall) !== null)
    ) {
      // allowed ONLY as a direct JSX child: <ul>{items.map(...)}</ul>
      const immediateParent = ctx.astAnalysis?.parentByNode.get(call) ?? null;
      const parent = immediateParent?.type === 'ChainExpression'
        ? ctx.astAnalysis?.parentByNode.get(immediateParent) ?? null
        : immediateParent;
      const grand = parent === null
        ? null
        : ctx.astAnalysis?.parentByNode.get(parent) ?? null;
      if (
        parent?.type !== 'JSXExpressionContainer' ||
        (grand?.type !== 'JSXElement' &&
          grand?.type !== 'JSXFragment' &&
          !isRenderAttributeContainer(ctx, parent))
      ) {
        fail(
          'memo-dom: list rendering must be a direct JSX child: <ul>{items.map(item => <Row />)}</ul>',
        );
      }
      // full form validation happens in collectReads (needs composition)
      return false;
    }
    return true;
  };
  walkAst<BaseNode>(p.node as unknown as BaseNode, {
    enter(node) {
      if (node.type === 'JSXElement') {
      const element = node as unknown as t.JSXElement;
      const open = element.openingElement;
      const openName = open.name;
      if (!astFactory.isJSXIdentifier(openName)) {
        return fail(
          'memo-dom: namespaced or member-expression JSX tags are not supported (L1)',
        );
      }
      if (isImperativeJsx(ctx, node)) {
        fail(
          'memo-dom: JSX built in a loop or with push() runs once and never updates — render lists with items.map(item => <Row key={item.id} />) as a direct JSX child',
          node as unknown as t.Node,
        );
      }
      // key is region metadata — meaningless (and misleading) elsewhere
      for (const attr of open.attributes) {
        if (
          !astFactory.isJSXSpreadAttribute(attr) &&
          astFactory.isJSXIdentifier(attr.name, { name: 'key' })
        ) {
          if (isRenderCallbackJsxRoot(ctx, node)) continue;
          fail(
            'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
            attr,
          );
        }
      }
      const tag = openName.name;
      if (/^[A-Z]/.test(tag)) {
        const localComponent = ctx.comps.has(tag);
        if (!localComponent && !ctx.importedComponents.has(tag)) {
          fail(
            `memo-dom: <${tag} /> is not a linked component factory`,
          );
        }
        // R10: state-reading props are allowed — prop reads are collected
        // by collectReads' generic Identifier/MemberExpression visitors (no
        // component skip there), so the parent updates exactly when a pushed
        // value can change. (Was the mount-time ban, now lifted.)
        if (localComponent) ctx.comps.get(tag)!.parents.add(name);
        let counts = ctx.childRefCounts.get(name);
        if (!counts) ctx.childRefCounts.set(name, (counts = new Map()));
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        if (
          element.children.some(
            (child) =>
              !astFactory.isJSXText(child) || child.value !== '',
          ) ||
          open.attributes.some((attribute) => {
            if (
              astFactory.isJSXSpreadAttribute(attribute) ||
              ctx.componentProps
                .get(tag)
                ?.renderProps.includes(
                  astFactory.isJSXIdentifier(attribute.name)
                    ? attribute.name.name
                    : attribute.name.name.name,
                ) !== true
            ) {
              return false;
            }
            const value = attrExpr(attribute.value);
            return value !== null && nodeHasJsx(value);
          })
        ) {
          ctx.renderSlotOwners.add(name);
        }
        // Nested syntax is a lexical content slot owned by this component.
        // Continue into it to discover and validate the authored subtree.
        return;
      }
      info.jsxCount++;
      return;
      }
      if (node.type === 'ConditionalExpression' && containsJsx(node)) {
        const parent = ctx.astAnalysis?.parentByNode.get(node) ?? null;
        const grand = parent === null
          ? null
          : ctx.astAnalysis?.parentByNode.get(parent) ?? null;
        if (
          parent?.type !== 'JSXExpressionContainer' ||
          (grand?.type !== 'JSXElement' &&
            grand?.type !== 'JSXFragment' &&
            !isRenderAttributeContainer(ctx, parent))
        ) {
          fail(
            'memo-dom: conditional rendering must be a direct JSX child: <div>{cond ? <A/> : <B/>}</div>',
          );
        }
        return false;
      }
      if (node.type === 'LogicalExpression' && containsJsx(node)) {
        const logical = node as unknown as t.LogicalExpression;
        if (logical.operator !== '&&' && logical.operator !== '||') {
          fail(
            'memo-dom: only && / || conditionals are supported (R8 L1), not ??',
          );
        }
        const parent = ctx.astAnalysis?.parentByNode.get(node) ?? null;
        const grand = parent === null
          ? null
          : ctx.astAnalysis?.parentByNode.get(parent) ?? null;
        if (
          parent?.type !== 'JSXExpressionContainer' ||
          (grand?.type !== 'JSXElement' &&
            grand?.type !== 'JSXFragment' &&
            !isRenderAttributeContainer(ctx, parent))
        ) {
          fail(
            'memo-dom: conditional rendering must be a direct JSX child: <div>{cond ? <A/> : <B/>}</div>',
          );
        }
        return false;
      }
      if (
        node.type === 'CallExpression' ||
        node.type === 'OptionalCallExpression'
      ) {
        return checkMapCall(node);
      }
      return;
    },
  });
}
