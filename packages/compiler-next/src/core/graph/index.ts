/**
 * Assemble feature facts without changing the resolved program.
 * Allocate nodes before connecting them so forward edges and cycles are ordinary.
 */
import type { Node } from 'yuku-parser';
import { declaringRunner, isRuntimeBinding, runnerOf } from '../resolve';
import type { Binding, Reference, Resolved, ResolvedModule } from '../resolve';
import type {
  BindingFacts, BindingNode, GraphNode, GraphOwner, InitialComputation,
  OwnerGraph, ReadEdge, ReadFact, SemanticGraph, UnresolvedNode, WriteEdge,
} from './model';

export type {
  BindingFacts, BindingKind, BindingNode, BodyBuilder, GraphNode, GraphOwner,
  InitialComputation, OwnerGraph, ReadEdge, ReadFact, SemanticGraph, SourceNode,
  UnresolvedNode, WriteEdge,
} from './model';
export { isReactive, pending } from './rules';

/** Mutable only inside this stage while edges are connected; never handed to features. */
interface BindingDraft extends BindingNode {
  reads: ReadEdge[];
  writes: WriteEdge[];
}

export function buildGraph(
  resolved: Resolved,
  facts: ReadonlyMap<Binding, BindingFacts>,
): SemanticGraph {
  const modules = new Map(resolved.modules.map((module) => [module.module, module]));
  const owners = new Map<ResolvedModule, Map<Node | null, GraphOwner>>();
  const bindings = new Map<Binding, BindingDraft>();
  const unresolved = new Map<Reference, UnresolvedNode>();
  const nodes: GraphNode[] = [];

  function ownerOf(module: ResolvedModule, runner: Node | null): GraphOwner {
    let runners = owners.get(module);
    if (runners === undefined) {
      runners = new Map();
      owners.set(module, runners);
    }
    let owner = runners.get(runner);
    if (owner === undefined) {
      owner = { module, runner };
      runners.set(runner, owner);
    }
    return owner;
  }

  for (const module of resolved.modules) {
    ownerOf(module, null);
    for (const binding of module.module.bindings) {
      if (!isRuntimeBinding(binding)) continue;
      const feature = facts.get(binding);
      const node: BindingDraft = {
        kind: feature?.kind ?? 'Opaque',
        binding,
        owner: ownerOf(module, declaringRunner(module.module, binding)),
        initial: copyInitial(feature?.initial),
        reads: [],
        writes: [],
      };
      bindings.set(binding, node);
      nodes.push(node);
    }
  }

  function unresolvedRead(reference: Reference): UnresolvedNode {
    const existing = unresolved.get(reference);
    if (existing !== undefined) return existing;
    const module = modules.get(reference.module);
    if (module === undefined) {
      throw new Error('memo-dom: graph read belongs to another resolved project');
    }
    const node: UnresolvedNode = {
      kind: 'Opaque',
      binding: null,
      reference,
      owner: ownerOf(module, runnerOf(module.module, reference.node)),
      reads: [],
      writes: [],
    };
    unresolved.set(reference, node);
    nodes.push(node);
    return node;
  }

  function readEdge(read: ReadFact): ReadEdge {
    const binding = read.binding ?? read.reference.binding;
    const target = binding === null ? unresolvedRead(read.reference) : bindings.get(binding);
    if (target === undefined) {
      // This is a compiler fact error, not rejection of an authored expression.
      throw new Error('memo-dom: graph dependency is not a runtime binding in this project');
    }
    return { target, reference: read.reference, path: [...(read.path ?? [])] };
  }

  for (const [binding, node] of bindings) {
    const feature = facts.get(binding);
    node.reads = (feature?.reads ?? []).map(readEdge);

    // Keep the local import node and its identity, then link to the definition.
    // Re-exports and circular imports are resolved by yuku, not by name matching.
    const definition = binding.definition();
    if (definition?.binding != null && definition.binding !== binding) {
      const target = bindings.get(definition.binding);
      if (target !== undefined) {
        node.reads.push({ target, reference: null, path: [] });
      }
    }

    const module = node.owner.module;
    node.writes = (module.writes.get(binding) ?? []).map((site) => ({
      site,
      owner: ownerOf(module, site.runner),
    }));
  }

  const ownerNodes = new Map<GraphOwner, GraphNode[]>();
  for (const runners of owners.values()) {
    for (const owner of runners.values()) ownerNodes.set(owner, []);
  }
  for (const node of nodes) ownerNodes.get(node.owner)!.push(node);
  const groups: OwnerGraph[] = [...ownerNodes].map(([owner, owned]) => ({ owner, nodes: owned }));

  return { resolved, owners: groups, nodes, bindings, unresolved };
}

function copyInitial(initial: InitialComputation | undefined): InitialComputation | null {
  if (initial === undefined) return null;
  return {
    initializer: initial.initializer,
    builders: initial.builders
      .map((builder) => ({ ...builder }))
      .sort((left, right) => left.statement.start - right.statement.start),
  };
}
