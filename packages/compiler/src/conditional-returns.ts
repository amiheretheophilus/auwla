/**
 * A component may return its conditional directly:
 *
 *   return items.length ? <ul>…</ul> : null;   →   return <>{items.length ? <ul>…</ul> : null}</>;
 *
 * Conditional rendering is planned only as a JSX child, so the bare form is
 * wrapped in a fragment, which adds no DOM. Only a capitalized function's own
 * returns are rewritten; callbacks inside it (a `.map` row) keep their shape.
 * The lowering runs before any analysis, so every backend sees ordinary code.
 */
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { walkAst, type BaseNode } from './ast';
import type { ProgramPath } from './context';

function isConditionalJsx(node: t.Node | null | undefined): node is t.Expression {
  if (!node || !(astFactory.isConditionalExpression(node) ||
      astFactory.isLogicalExpression(node) && (node.operator === '&&' || node.operator === '||'))) return false;
  let found = false;
  walkAst(node as unknown as BaseNode, {
    enter(child) {
      if (found || astFactory.isFunction(child as unknown as t.Node)) return false;
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') found = true;
      return;
    },
  });
  return found;
}

const fragment = (expression: t.Expression): t.JSXFragment => astFactory.jsxFragment(
  astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(),
  [astFactory.jsxExpressionContainer(expression)]);

/** Wrap the component's own conditional returns; nested functions are skipped. */
function lowerComponent(component: t.Function): boolean {
  if (astFactory.isArrowFunctionExpression(component) && !astFactory.isBlockStatement(component.body)) {
    if (!isConditionalJsx(component.body)) return false;
    component.body = fragment(component.body);
    return true;
  }
  let changed = false;
  walkAst(component.body as unknown as BaseNode, {
    enter(node) {
      if (astFactory.isFunction(node as unknown as t.Node)) return false;
      if (node.type !== 'ReturnStatement') return;
      const statement = node as unknown as t.ReturnStatement;
      if (!isConditionalJsx(statement.argument)) return;
      statement.argument = fragment(statement.argument);
      changed = true;
      return false;
    },
  });
  return changed;
}

const isComponentName = (name: string | undefined) => name !== undefined && /^[A-Z]/.test(name);

/** Returns whether code changed. */
export function lowerConditionalReturns(program: ProgramPath): boolean {
  let changed = false;
  walkAst(program.node as unknown as BaseNode, {
    enter(node) {
      const value = node as unknown as t.Node;
      if (astFactory.isFunctionDeclaration(value) && isComponentName(value.id?.name)) {
        changed = lowerComponent(value) || changed;
      } else if (astFactory.isVariableDeclarator(value) && astFactory.isIdentifier(value.id) &&
          isComponentName(value.id.name) && value.init && astFactory.isFunction(value.init)) {
        changed = lowerComponent(value.init) || changed;
      }
    },
  });
  return changed;
}
