/**
 * What can change in a plain function, a function that is not a component
 * (`wiki/compiler/state-and-derived.md`, "Plain functions").
 *
 * A component's values follow what they read, including reads the compiler cannot
 * see. A plain function runs when it is called, and JavaScript gives its locals their
 * value then. So here a value only follows a change the compiler can see, in any scope:
 *
 * - `let twice = count * 2`, with `count++` in a later callback, is computed again;
 * - `const id = options.id` and `const result = options.action(payload)` run once,
 *   since an unknown call that might edit `options` is not a change it can see.
 *
 * A reader is a separate question. An edit the compiler only suspects can still change
 * what a later read shows, so a binding keeps its reader unless nothing can edit it.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode, GraphNode, SemanticGraph, WriteEdge } from '../graph';
import type { InputQueries } from '../graph/inputs';
import { namespaceModule } from '../resolve';
import { methodFact } from '../../optimize/method-facts';

export interface PlainFunctionValues {
  /** Whether computing this binding's declaration again could give another value. */
  replays(node: BindingNode): boolean;
  /** Whether this binding is in a plain function, and can never hold anything else. */
  settled(node: BindingNode): boolean;
}

/** Edits of a Map or Set, which `method-facts.ts` does not list: it only decides array calls. */
const COLLECTION_EDITS = new Set(['set', 'add', 'delete', 'clear']);

/**
 * `x = 1`, `x.a = 1`, `delete x.a` and `x.push(1)`, run by a later call. A write during
 * the declaring run builds the value once. An unknown method or a call that receives
 * the value might edit it, but that is not a change the compiler can see.
 */
function isVisibleLaterWrite(node: BindingNode, { site }: WriteEdge): boolean {
  if (site.runner === node.owner.runner) return false;
  if (site.kind === 'argument') return false;
  if (site.kind !== 'call') return true;
  if (typeof site.method !== 'string') return false;
  return methodFact(site.method)?.kind === 'edit' || COLLECTION_EDITS.has(site.method);
}

/** Changes on its own, whatever it writes or reads. */
function isLiveInput(node: GraphNode, components: ReadonlySet<Node>): boolean {
  if (node.binding === null) return node.reactive;
  if (node.kind === 'Source' || node.kind === 'Ref' || node.kind === 'Prop') return true;
  if (namespaceModule(node.binding) !== null) return true;
  // A component's own values follow reads the compiler cannot see.
  const runner = node.owner.runner;
  return runner !== null && components.has(runner) && node.kind !== 'Constant';
}

/** Every node a seed reaches through reads. A worklist, since reads can form cycles. */
function spreadThroughReads(graph: SemanticGraph, isSeed: (node: GraphNode) => boolean): ReadonlySet<GraphNode> {
  const reached = new Set<GraphNode>();
  const readers = new Map<GraphNode, GraphNode[]>();
  const work: GraphNode[] = [];

  const mark = (node: GraphNode): void => {
    if (reached.has(node)) return;
    reached.add(node);
    work.push(node);
  };

  for (const node of graph.nodes) {
    if (isSeed(node)) mark(node);
    for (const edge of node.reads) {
      const list = readers.get(edge.target) ?? [];
      list.push(node);
      readers.set(edge.target, list);
    }
  }

  for (let index = 0; index < work.length; index++) {
    for (const reader of readers.get(work[index]!) ?? []) mark(reader);
  }
  return reached;
}

export function plainFunctionValues(
  graph: SemanticGraph,
  components: ReadonlySet<Node>,
  queries: InputQueries,
): PlainFunctionValues {
  const editable = spreadThroughReads(graph, (node) => isLiveInput(node, components) || node.writes.length > 0);

  const inPlainFunction = (node: BindingNode): boolean => {
    const runner = node.owner.runner;
    return runner !== null && is.Function(runner) && !components.has(runner);
  };

  /**
   * What this binding's declaration and definite builders read. A possible builder
   * only might change the value, so what it reads is not an input of the value:
   * `if (!done) stop = tracker.onError(…)` does not make `tracker` follow `done`.
   */
  const definiteInputs = (node: BindingNode): readonly BindingNode[] => {
    const initial = node.initial;
    if (initial === null) return [];
    const module = node.binding.module;
    const definite = initial.builders.filter((builder) => builder.certainty === 'definite').map((builder) => builder.statement);
    const roots = [initial.initializer, initial.pattern ?? null, ...definite].filter((root) => root !== null);
    const inputs = new Set<BindingNode>();
    for (const root of roots) {
      for (const read of queries.inputsOf(module, root).reads) {
        const binding = read.binding ?? read.reference.binding;
        const input = binding === null ? undefined : graph.bindings.get(binding);
        if (input !== undefined && input !== node) inputs.add(input);
      }
    }
    return [...inputs];
  };

  const moving = new Set<BindingNode>();
  const followers = new Map<BindingNode, BindingNode[]>();
  const work: BindingNode[] = [];
  const move = (node: BindingNode): void => {
    if (moving.has(node)) return;
    moving.add(node);
    work.push(node);
  };
  for (const node of graph.bindings.values()) {
    if (isLiveInput(node, components) || node.writes.some((edge) => isVisibleLaterWrite(node, edge))) move(node);
    for (const input of definiteInputs(node)) {
      const list = followers.get(input) ?? [];
      list.push(node);
      followers.set(input, list);
    }
  }
  for (let index = 0; index < work.length; index++) {
    for (const follower of followers.get(work[index]!) ?? []) move(follower);
  }

  return {
    replays(node) {
      if (!inPlainFunction(node) || node.kind === 'Source') return true;
      return definiteInputs(node).some((input) => moving.has(input));
    },
    settled(node) {
      return inPlainFunction(node) && !editable.has(node);
    },
  };
}
