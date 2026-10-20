/** Static reads stop at function boundaries; actual invocation reads are observed at runtime. */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

export function crossesFunction(module: Module, node: Node, scope: Node): boolean {
  if (node === scope) return false;
  let current = module.parentOf(node);
  while (current !== null && current !== scope) {
    if (is.Function(current)) return true;
    current = module.parentOf(current);
  }
  return false;
}
