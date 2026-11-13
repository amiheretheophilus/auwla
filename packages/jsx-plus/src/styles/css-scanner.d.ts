// Narrow declarations for the scanner shipped by the pinned CSS service (6.3.10).
// The package publishes this JavaScript module without its internal declarations.
declare module 'vscode-css-languageservice/lib/esm/parser/cssScanner.js' {
  export const TokenType: Readonly<{
    Ident: number;
    SemiColon: number;
    CurlyL: number;
    CurlyR: number;
    EOF: number;
  }>;

  export interface CssToken {
    readonly type: number;
    readonly offset: number;
    readonly len: number;
  }

  export class Scanner {
    setSource(source: string): void;
    scan(): CssToken;
  }
}
