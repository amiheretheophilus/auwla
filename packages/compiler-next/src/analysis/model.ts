/** Public snapshot types. No analyzer objects or mutable graph nodes escape. */
export type AnalysisRange = readonly [number, number];

export type AnalysisBindingKind =
  | 'Constant'
  | 'State'
  | 'Derived'
  | 'Prop'
  | 'Source'
  | 'Ref'
  | 'Opaque';

export interface AnalysisReference {
  readonly range: AnalysisRange;
  readonly write: boolean;
  readonly runner: AnalysisRange | null;
}

export interface AnalysisUnresolvedInput {
  readonly name: string;
  readonly module: string;
  readonly range: AnalysisRange;
  readonly reactive: boolean;
}

export interface AnalysisWrite {
  readonly range: AnalysisRange;
  readonly kind: string;
  /** Lexical placement only: a nested callback may execute immediately. */
  readonly timing: 'body' | 'later';
  readonly runner: AnalysisRange | null;
}

export interface AnalysisBuilder {
  readonly range: AnalysisRange;
  readonly certainty: 'definite' | 'possible';
  readonly waits: boolean;
  readonly invocation?: 'runtime';
}

/** Static compiler facts are not a complete account of unknown runtime reads. */
export interface AnalysisComputation {
  readonly initializer: AnalysisRange | null;
  readonly dependencies: readonly string[];
  readonly unresolved: readonly AnalysisUnresolvedInput[];
  readonly opaque: boolean;
  readonly builders: readonly AnalysisBuilder[];
}

export interface AnalysisBinding {
  /** Snapshot-local identity, shared by references/dependencies across modules. */
  readonly id: string;
  readonly name: string;
  readonly kind: AnalysisBindingKind;
  /** Declaration extents can include annotations; these are not rename edits. */
  readonly declarations: readonly AnalysisRange[];
  readonly owner: AnalysisRange | null;
  readonly componentOwned: boolean;
  readonly references: readonly AnalysisReference[];
  /** Includes live-import links even when there is no local initializer. */
  readonly dependencies: readonly string[];
  readonly unresolved: readonly AnalysisUnresolvedInput[];
  readonly writes: readonly AnalysisWrite[];
  readonly computation: AnalysisComputation | null;
}

export interface AnalysisExpression {
  readonly range: AnalysisRange;
  readonly dependencies: readonly string[];
  readonly unresolved: readonly AnalysisUnresolvedInput[];
  readonly opaque: boolean;
}

export interface AnalysisEscapingFunction {
  readonly range: AnalysisRange;
  readonly dependencies: readonly string[];
  readonly unresolved: readonly AnalysisUnresolvedInput[];
  readonly receiver: boolean;
}

export interface AnalysisModule {
  readonly path: string;
  readonly inputSource: string;
  readonly analysisSource: string;
  /** Input offsets are usable only within inputSource's preserved prefix. */
  readonly coordinates: 'input-prefix' | 'lowered';
  readonly bindings: readonly AnalysisBinding[];
  readonly expressions: readonly AnalysisExpression[];
  readonly escapingFunctions: readonly AnalysisEscapingFunction[];
}

export interface CompilerAnalysis {
  readonly version: 1;
  readonly modules: readonly AnalysisModule[];
}
