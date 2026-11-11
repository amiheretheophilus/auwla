/** TypeScript 7.1 mapper protocol; offsets are UTF-16 code units. */
export type SpanMapping = [
  virtualStart: number,
  virtualLength: number,
  originalStart: number,
  originalLength: number,
  kind: 0,
  features?: 0, // None disables editor features while retaining diagnostic mapping.
];

/** Ignore one view's semantic diagnostics only where the other view checks. */
export interface DiagnosticDirectives {
  readonly unusedExpectDirectiveDiagnostics: [];
  readonly directives: [
    originalStart: number,
    originalLength: number,
    virtualStart: number,
    virtualEnd: number,
    kind: 0,
  ][];
}

export interface CheckingOutput {
  readonly text: string;
  readonly extension: '.tsx';
  readonly mappings: SpanMapping[];
  readonly diagnosticDirectives?: DiagnosticDirectives;
}

export interface CheckingSource extends CheckingOutput {
  readonly supplemental?: CheckingOutput[];
  readonly diagnostics?: readonly {
    readonly messageText: string;
    readonly start: number;
    readonly length: number;
    readonly code: number;
  }[];
}
