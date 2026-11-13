/// <reference path="./css-scanner.d.ts" />
/** Bounded, checking-only recovery for a bare property name before `}`, `;` or EOF. */
import type { Diagnostic, LanguageService, Stylesheet } from 'vscode-css-languageservice';
import { Scanner, TokenType, type CssToken } from 'vscode-css-languageservice/lib/esm/parser/cssScanner.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { blankRange } from '../masks';

interface Token extends CssToken {
  /** The surrounding `{`, retained so a checking-only empty rule does not gain a warning. */
  readonly body: number | undefined;
}

function tokensOf(source: string): Token[] {
  const scanner = new Scanner();
  scanner.setSource(source);
  const tokens: Token[] = [];
  const braces: number[] = [];

  for (;;) {
    const token = scanner.scan();
    tokens.push({ ...token, body: braces.at(-1) });
    if (token.type === TokenType.CurlyL) {
      braces.push(token.offset);
    } else if (token.type === TokenType.CurlyR) {
      braces.pop();
    } else if (token.type === TokenType.EOF) {
      return tokens;
    }
  }
}

/** Keep the same text width and line endings; production CSS never uses this view. */
export function recoverCss(service: LanguageService, authored: TextDocument) {
  let document = authored;
  let stylesheet: Stylesheet = service.parseStylesheet(document);
  let diagnostics = service.doValidation(document, stylesheet);
  if (!diagnostics.some((diagnostic) => diagnostic.code === 'css-colonexpected')) {
    return { stylesheet, diagnostics };
  }

  const tokens = tokensOf(authored.getText());
  const at = new Map(tokens.map((token, index) => [token.offset, index]));
  const recoveredBodies = new Set<number>();
  const removed = new Set<number>();
  const primary: Diagnostic[] = [];

  // Normally one pass is enough. Bound pathological broken files instead of
  // repeatedly parsing an arbitrarily large stylesheet while a user is typing.
  for (let pass = 0; pass < 8; pass++) {
    let source = document.getText();
    let changed = false;

    for (const diagnostic of diagnostics) {
      if (diagnostic.code !== 'css-colonexpected') {
        continue;
      }
      const index = at.get(document.offsetAt(diagnostic.range.start));
      if (index === undefined || index < 2) {
        continue;
      }
      const boundary = tokens[index]!;
      const property = tokens[index - 1]!;
      const before = tokens[index - 2]!;
      const closesDeclaration = boundary.type === TokenType.CurlyR
        || boundary.type === TokenType.SemiColon || boundary.type === TokenType.EOF;
      const startsDeclaration = before.type === TokenType.CurlyL
        || before.type === TokenType.CurlyR || before.type === TokenType.SemiColon;

      if (!closesDeclaration || !startsDeclaration || property.type !== TokenType.Ident
        || property.body === undefined || removed.has(property.offset)) {
        continue;
      }

      primary.push({
        ...diagnostic,
        range: {
          start: authored.positionAt(property.offset),
          end: authored.positionAt(property.offset + property.len),
        },
      });
      removed.add(property.offset);
      recoveredBodies.add(property.body);
      source = blankRange(source, property.offset, property.offset + property.len);
      changed = true;
    }

    if (!changed) {
      break;
    }
    document = TextDocument.create(authored.uri, authored.languageId, authored.version, source);
    stylesheet = service.parseStylesheet(document);
    diagnostics = service.doValidation(document, stylesheet);
  }

  // Blanking the only unfinished declaration can make its rule temporarily
  // empty. Preserve warnings on genuinely empty rules elsewhere in the file.
  const remaining = diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 'emptyRules' || recoveredBodies.size === 0) {
      return true;
    }
    const end = document.offsetAt(diagnostic.range.end);
    const next = tokens.find((token) => token.offset >= end);
    return next?.type !== TokenType.CurlyL || !recoveredBodies.has(next.offset);
  });

  return { stylesheet, diagnostics: [...primary, ...remaining] };
}
