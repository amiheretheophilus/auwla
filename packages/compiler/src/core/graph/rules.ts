/** Shared graph queries. Traversals are iterative so long chains cannot overflow the stack. */
import type { GraphNode, ReadEdge, SourceNode } from './model';

/**
 * Known source dependencies, including the node itself when it is a source.
 * This is a candidate set, not a command to wait for inactive branches. A caller
 * with branch/invocation information can exclude edges with `follows`; source
 * planning must preserve that information when it emits readiness guards.
 */
export function pending(
  node: GraphNode,
  follows: (edge: ReadEdge) => boolean = () => true,
): ReadonlySet<SourceNode> {
  const sources = new Set<SourceNode>();
  for (const dependency of reachable(node, (edge) => edge.readiness !== false && follows(edge))) {
    if (dependency.kind === 'Source' && dependency.binding !== null) {
      sources.add(dependency as SourceNode);
    }
  }
  return sources;
}

/**
 * An opaque value may change when its owner updates. State, props, derived
 * values, sources and refs are reactive roots; constants inherit reactivity
 * through their reads. A global the program never writes is not an input.
 * Features use this query while settling classifications.
 */
export function isReactive(node: GraphNode): boolean {
  for (const dependency of reachable(node, () => true)) {
    if (isReactiveRoot(dependency)) return true;
  }
  return false;
}

function isReactiveRoot(node: GraphNode): boolean {
  if (node.binding === null) return node.reactive;
  return node.kind !== 'Constant';
}

function* reachable(
  node: GraphNode,
  follows: (edge: ReadEdge) => boolean,
): IterableIterator<GraphNode> {
  const visited = new Set<GraphNode>();
  const work = [node];
  while (work.length > 0) {
    const current = work.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    yield current;
    for (const edge of current.reads) {
      if (follows(edge) && !visited.has(edge.target)) work.push(edge.target);
    }
  }
}
