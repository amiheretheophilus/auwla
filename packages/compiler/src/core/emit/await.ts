/** Native await keeps its value, rejection and suspension; commits precede it. */
import { findAll } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { cloneTree, copy } from './copy';
import { expression } from './quote';

export function emitAwaitBoundaries(tree: Node, runtime: string): Node {
  // With no await, the result is what the full pass gives: a fresh tree, every node its own
  // (none shared) and with no authored origin. One plain copy makes it; a `structuredClone`
  // and a `copy` of every module measured as a large part of emitting (`wiki/compiler/project.md`,
  // "Start-up time").
  if (findAll(tree, 'AwaitExpression').length === 0) {
    return plainCopy(tree);
  }
  // Setup and update can contain distinct copies of the same authored await.
  // This final pass addresses emitted occurrences, after source composition;
  // earlier authored origins and sealed subtrees must no longer coalesce them.
  // A copy that keeps shared nodes shared, as `structuredClone` does, and faster (`copy.ts`).
  const emitted = cloneTree(tree);
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

/**
 * A structural copy of plain syntax: every occurrence copied apart, no origins kept. It is the
 * final tree for a module with no boundaries to emit (`emitDom` when nothing guards writes).
 */
export function plainCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(plainCopy) as T;
  }
  const output: Record<string, unknown> = {};
  const node = value as Record<string, unknown>;
  for (const key in node) {
    output[key] = plainCopy(node[key]);
  }
  return output as T;
}
