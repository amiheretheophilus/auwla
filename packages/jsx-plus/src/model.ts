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

/** `for (const binding of iterable) { body }`; `binding` is the pattern's source. */
export interface ForView {
  readonly kind: 'for';
  readonly range: Range;
  readonly binding: ExpressionView;
  readonly iterable: ExpressionView;
  readonly body: BlockView;
}

export type ChildView = ExpressionView | ElementView | FragmentView | IfView | ForView;

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
