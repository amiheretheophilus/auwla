/** Syntax-only views. Ref and semantic binding nodes stay in compiler-next. */
export type Range = readonly [number, number];

export interface ExpressionView {
  readonly kind: 'expression';
  readonly range: Range;
  readonly source: string;
}

export interface ElementView {
  readonly kind: 'element';
  readonly range: Range;
  readonly name: string;
  readonly children: readonly ChildView[];
}

export interface FragmentView {
  readonly kind: 'fragment';
  readonly range: Range;
  readonly children: readonly ChildView[];
}

export interface BlockView {
  readonly kind: 'block';
  readonly range: Range;
  readonly children: readonly ChildView[];
}

export interface IfView {
  readonly kind: 'if';
  readonly range: Range;
  readonly test: ExpressionView;
  readonly consequent: BlockView;
  readonly alternate: BlockView | IfView | null;
}

export type ChildView = ExpressionView | ElementView | FragmentView | IfView;

export interface VerbatimMapping {
  readonly kind: 'verbatim';
  readonly generated: Range;
  readonly authored: Range;
}

export interface NormalizedSource {
  readonly code: string;
  readonly roots: readonly (ElementView | FragmentView)[];
  readonly mappings: readonly VerbatimMapping[];
}
