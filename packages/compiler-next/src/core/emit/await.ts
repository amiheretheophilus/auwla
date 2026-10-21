/** Native await keeps its value, rejection and suspension; commits precede it. */
import { findAll } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { copy } from './copy';
import { expression } from './quote';

export function emitAwaitBoundaries(tree: Node, runtime: string): Node {
  const replacements = new Map<Node, Node>();
  for (const original of findAll(tree, 'AwaitExpression').reverse()) {
    const awaited = copy(original, replacements);
    awaited.argument = expression('$$runtime.flushWritesBeforeAwait($$argument)', { runtime, argument: awaited.argument });
    replacements.set(original, expression('$$runtime.resumeWritesAfterAwait($$awaited)', { runtime, awaited }));
  }
  return copy(tree, replacements);
}
