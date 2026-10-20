/**
 * The shared graph contract. Features supply meaning; core connects their facts.
 * Every binding keeps its analyzer identity, including shadowed names and imports.
 */
import type { Node } from 'yuku-parser';
import type { Binding, PathKey, Reference, Resolved, ResolvedModule, WriteSite } from '../resolve';

export type BindingKind = 'Constant' | 'State' | 'Derived' | 'Prop' | 'Source' | 'Ref' | 'Opaque';

/**
 * A lexical execution owner, not a mounted instance. The runtime will create
 * separate storage for each invocation of a component, helper or factory.
 */
export interface GraphOwner {
  readonly module: ResolvedModule;
  /** Null for module execution; otherwise a function or instance field initializer. */
  readonly runner: Node | null;
}

/** A statement that contributes to a value, in authored source order. */
export interface BodyBuilder {
  readonly statement: Node;
  /** Unknown calls must first be observed to determine whether they changed the value. */
  readonly certainty: 'definite' | 'possible';
}

export interface InitialComputation {
  readonly initializer: Node | null;
  readonly builders: readonly BodyBuilder[];
}

/**
 * A feature's dependency fact. Reading a callback's identity does not imply
 * reading its captures; invocation analysis supplies those edges separately.
 */
export interface ReadFact {
  readonly reference: Reference;
  /** Defaults to reference.binding. A feature may resolve an alias to another binding. */
  readonly binding?: Binding;
  /** [] reads the value itself; null is a computed property step. */
  readonly path?: readonly PathKey[];
}

export interface BindingFacts {
  /** The initial classification. A potential later write does not change it. */
  readonly kind: BindingKind;
  readonly initial?: InitialComputation;
  readonly reads?: readonly ReadFact[];
}

export interface ReadEdge {
  readonly target: GraphNode;
  /** Null only for an import's implicit live-binding link. */
  readonly reference: Reference | null;
  readonly path: readonly PathKey[];
}

/**
 * Preserve the original assignment form and execution owner for later planning.
 * `site.timing` is lexical nesting, not proof that this invocation runs later.
 */
export interface WriteEdge {
  readonly site: WriteSite;
  readonly owner: GraphOwner;
}

export interface BindingNode {
  readonly kind: BindingKind;
  readonly binding: Binding;
  readonly owner: GraphOwner;
  readonly initial: InitialComputation | null;
  readonly reads: readonly ReadEdge[];
  readonly writes: readonly WriteEdge[];
}

/** A runtime global or another unbound read: retain it as opaque, never drop it. */
export interface UnresolvedNode {
  readonly kind: 'Opaque';
  readonly binding: null;
  readonly reference: Reference;
  readonly owner: GraphOwner;
  readonly reads: readonly ReadEdge[];
  readonly writes: readonly WriteEdge[];
}

export type GraphNode = BindingNode | UnresolvedNode;
export type SourceNode = BindingNode & { readonly kind: 'Source' };

export interface OwnerGraph {
  readonly owner: GraphOwner;
  readonly nodes: readonly GraphNode[];
}

export interface SemanticGraph {
  readonly resolved: Resolved;
  /** All lexical owners, including empty modules and owners of captured writes. */
  readonly owners: readonly OwnerGraph[];
  readonly nodes: readonly GraphNode[];
  readonly bindings: ReadonlyMap<Binding, BindingNode>;
  readonly unresolved: ReadonlyMap<Reference, UnresolvedNode>;
}
