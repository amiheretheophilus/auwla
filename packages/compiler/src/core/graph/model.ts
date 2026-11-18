/**
 * The shared graph contract. Features supply meaning; core connects their facts.
 * Every binding keeps its analyzer identity, including shadowed names and imports.
 */
import type { Node } from 'yuku-parser';
import type { Binding, PathKey, Reference, Resolved, ResolvedModule, WriteSite } from '../resolve';
import type { FunctionNode, FunctionSummary } from '../resolve/functions';

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
  /** The statement may invoke a callback now or retain it for later execution. */
  readonly invocation?: 'runtime';
  /**
   * Whether the value waits while this builder waits for a source
   * (`wiki/compiler/sources.md`, readiness; decisions 2026-10-19): it writes
   * the value, calls a method on it, or passes the value itself to a call.
   * Passing only a member (`Math.max(items.length)`) can still change nested
   * data, so it stays a builder that is observed, but it does not make the
   * value wait.
   */
  readonly waits: boolean;
}

export interface InitialComputation {
  readonly initializer: Node | null;
  /** Native declaration/parameter pattern, shared by its aliases. */
  readonly pattern?: Node;
  readonly builders: readonly BodyBuilder[];
  /** Static reads are incomplete; retain runtime checks when this computation runs. */
  readonly opaque?: boolean;
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
  /** Status reads stay reactive without waiting for the source payload. */
  readonly readiness?: boolean;
}

export interface BindingFacts {
  /** The initial classification. A potential later write does not change it. */
  readonly kind: BindingKind;
  readonly initial?: InitialComputation;
  readonly reads?: readonly ReadFact[];
  readonly takeovers?: readonly WriteSite[];
}

export interface ReadEdge {
  readonly target: GraphNode;
  /** Null only for an import's implicit live-binding link. */
  readonly reference: Reference | null;
  readonly path: readonly PathKey[];
  readonly readiness?: boolean;
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
  /** Candidate reassignments, never evidence that takeover has already happened. */
  readonly takeovers: readonly WriteSite[];
}

/** A runtime global or another unbound read: retain it as opaque, never drop it. */
export interface UnresolvedNode {
  readonly kind: 'Opaque';
  readonly binding: null;
  readonly reference: Reference;
  /**
   * Whether the program writes this global. A global it never writes (`Math`,
   * `setInterval`, `document`) is not an input (`../resolve/globals.ts`).
   */
  readonly reactive: boolean;
  readonly owner: GraphOwner;
  readonly reads: readonly ReadEdge[];
  readonly writes: readonly WriteEdge[];
}

export type GraphNode = BindingNode | UnresolvedNode;
export type SourceNode = BindingNode & { readonly kind: 'Source' };

/**
 * A feature's fact about an escaping function (`../resolve/escapes.ts`): what
 * its body reads, directly or through helpers it calls directly.
 */
export interface FunctionFacts {
  readonly fn: FunctionNode;
  readonly module: ResolvedModule;
  readonly reads: readonly ReadFact[];
  /** It reads through `this`, which the runtime maps to the receiver. */
  readonly receiver: boolean;
}

/**
 * A function unknown code may call during a computation. When it runs inside
 * one, it reports `reads` to it, so a value computed through an unknown caller
 * still follows them (`output.md`, "Phase 3 design", rule 5).
 */
export interface EscapingFunction {
  readonly fn: FunctionNode;
  /** Where the function is created. */
  readonly owner: GraphOwner;
  /** Only reactive targets: reading a constant needs no report. */
  readonly reads: readonly ReadEdge[];
  readonly receiver: boolean;
}

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
  readonly functions: readonly FunctionSummary[];
  /** Escaping functions that read reactive state or use a receiver; others need no report. */
  readonly escaping: readonly EscapingFunction[];
}
