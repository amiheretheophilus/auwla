/**
 * Reduce list row callbacks to their JSX before analysis reads the tree.
 *
 * A block of `const` derivations followed by `return <Row />` becomes the
 * returned JSX with each derivation substituted (see `planListCallback`).
 * Doing it here, once, means every later pass sees the same callback body.
 */
import type * as t from '../ast/compiler-types';
import { walkAst, type BaseNode } from '../ast';
import type { Ctx } from '../context';
import { planListCallback } from './callback-plan';
import { containsJsx } from './map-site';
import { matchMapCall } from './source-shapes';

export function normalizeListCallbacks(ctx: Ctx): void {
  for (const [, path] of ctx.compPaths) {
    const fail = (message: string, at?: t.Node): never => {
      throw path.buildCodeFrameError(message, at);
    };
    walkAst(path.node as unknown as BaseNode, {
      enter(node, parent) {
        // Lists render only as direct JSX children; read collection takes the same sites.
        if (parent?.type !== 'JSXExpressionContainer' && parent?.type !== 'ChainExpression') return;
        const call = matchMapCall(node as unknown as t.Node);
        if (call === null || !containsJsx(node)) return;
        const body = planListCallback(call, fail).normalizedBody;
        if (body !== null) (call.arguments[0] as t.ArrowFunctionExpression).body = body;
      },
    });
  }
}
