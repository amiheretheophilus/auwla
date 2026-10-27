/** Native await keeps its value, rejection and suspension; commits precede it. */
import { findAll } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { copy } from './copy';
import { expression } from './quote';

export function emitAwaitBoundaries(tree: Node, runtime: string): Node {
  // Setup and update can contain distinct copies of the same authored await.
  // This final pass addresses emitted occurrences, after source composition;
  // earlier authored origins and sealed subtrees must no longer coalesce them.
  const emitted = structuredClone(tree);
  const replacements = new Map<Node, Node>();
  for (const original of findAll(emitted, 'AwaitExpression').reverse()) {
    // Some emitted closures are used by both setup and update. A repeated
    // occurrence may already be in the map; copy only its argument here.
    const awaited = {
      ...original,
      argument: expression('$$runtime.flushWritesBeforeAwait($$argument)', {
        runtime,
        argument: copy(original.argument, replacements),
      }),
    };
    replacements.set(original, expression('$$runtime.resumeWritesAfterAwait($$awaited)', { runtime, awaited }));
  }
  return copy(emitted, replacements);
}
