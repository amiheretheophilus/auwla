/**
 * Whether a call's callback lets the runtime reuse each item's previous result
 * (`runtime/src/list-map.ts`), when the callee turns out to be the intrinsic
 * `map`. This proves facts about the callback only; it never reads the method
 * name, and the runtime still checks the callee's identity.
 *
 * The callback must be an arrow (no `this`, no `arguments`) that:
 *
 * - takes at most `(item, index)`, without a rest parameter: the array argument
 *   is new on every call;
 * - has no explicit effect (`effects.ts`), so skipping it skips nothing;
 * - returns JSX on every path, a compiler-owned value; a fresh object or array
 *   returned to authored code must stay fresh;
 * - reads nothing reactive except through readers the runtime tracks (shared
 *   bindings, and component bindings at the reads the plan emits as `trackRead`),
 *   besides its own parameters and locals. Other free variables must
 *   be constants that depend on nothing reactive (`isReactive`), or globals the
 *   program never writes. Nested functions are created, not run, so their
 *   bodies do not count.
 *
 * Then the result can only change with the item, an edit below it, the index
 * when it is read, or a tracked read, which is what the runtime checks.
 */
import type { Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { isReactive, type SemanticGraph } from '../core/graph';
import type { ModulePlan } from '../core/plan/model';
import { importedDefinition } from '../core/resolve';
import { effectFree } from './effects';

export interface RowReuse {
  readonly usesIndex: boolean;
}

function unwrap(node: Node): Node {
  return is.ParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

function isJsx(node: Node | null): boolean {
  if (node === null) return false;
  const value = unwrap(node);
  return is.JSXElement(value) || is.JSXFragment(value);
}

/** Every completion returns JSX: an expression body, or a block ending in such a return with no other kind. */
function returnsJsx(fn: Extract<Node, { type: 'ArrowFunctionExpression' }>): boolean {
  if (!is.BlockStatement(fn.body)) return isJsx(fn.body);
  const last = fn.body.body.at(-1);
  if (last === undefined || !is.ReturnStatement(last)) return false;
  let all = true;
  walk(fn.body, {
    enter: (node, ctx) => {
      if (is.Function(node)) {
        ctx.skip();
        return;
      }
      if (is.ReturnStatement(node) && !isJsx(node.argument)) {
        all = false;
        ctx.stop();
      }
    },
  });
  return all;
}

export function rowReuse(general: ModulePlan, graph: SemanticGraph, callback: Node): RowReuse | null {
  if (!is.ArrowFunctionExpression(callback) || callback.async || callback.params.length > 2) return null;
  if (callback.params.some((param) => is.RestElement(param))) return null;
  const module = general.module.module;
  if (!effectFree(module, callback) || !returnsJsx(callback)) return null;
  if (!freeReadsTracked(general, graph, module, callback)) return null;
  return { usesIndex: callback.params.length === 2 };
}

function freeReadsTracked(general: ModulePlan, graph: SemanticGraph, module: Module, callback: Node): boolean {
  const shared = new Set([...general.sharedReads.keys()].map((node) => node.binding));
  // Component bindings read here through `trackRead` (`ComponentPlan.trackedReads`).
  const trackedNodes = new Set([...general.components.values()].flatMap((component) =>
    component.trackedReads.map((read) => read.node)));
  let tracked = true;
  walk(callback, {
    enter: (node, ctx) => {
      if (node !== callback && is.Function(node)) {
        ctx.skip();
        return;
      }
      if (is.ThisExpression(node) || is.Super(node) || is.MetaProperty(node)) {
        tracked = false;
        ctx.stop();
        return;
      }
      if (!is.Identifier(node) && !is.JSXIdentifier(node)) return;
      const reference = module.referenceOf(node);
      if (reference === null || reference.inTypePosition) return;
      const binding = reference.binding;
      if (binding === null) {
        // A global the program writes is reactive; one it never writes is not an input.
        tracked = graph.unresolved.get(reference)?.reactive === false;
      } else {
        const declaration = binding.declarations[0];
        const local = declaration !== undefined
          && declaration.start >= callback.start && declaration.end <= callback.end;
        const definition = importedDefinition(binding) ?? binding;
        const constant = graph.bindings.get(definition);
        tracked = local || shared.has(binding) || shared.has(definition) || trackedNodes.has(node)
          || (constant !== undefined && !isReactive(constant));
      }
      if (!tracked) ctx.stop();
    },
  });
  return tracked;
}
