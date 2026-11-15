import * as vscode from 'vscode';
import type { ExtensionAPI } from 'typescript/vscode';
import { closingTagAt } from '@memoized-dom/jsx-plus/editor/tags';

/**
 * Synthetic checking closers make the virtual TSX balanced, so TypeScript's
 * own auto-insert can return null. Supply an authored-source proposal through
 * its existing handler: it already honors autoClosingTags, versions and undo.
 */
export function registerTags(context: vscode.ExtensionContext, api: Pick<ExtensionAPI, 'registerLspMiddleware'>): void {
  const registration = api.registerLspMiddleware('textDocument/_vs_onAutoInsert', (result, { params }) => {
    if (result !== null || params._vs_ch !== '>') {
      return result;
    }
    const document = vscode.workspace.textDocuments.find((candidate) =>
      candidate.languageId === 'auwla' && candidate.uri.toString() === params._vs_textDocument.uri);
    if (document === undefined) {
      return result;
    }

    const source = document.getText();
    const position = new vscode.Position(params._vs_position.line, params._vs_position.character);
    const offset = document.offsetAt(position);
    // A stale/out-of-range request must never get clamped into another tag.
    const actual = document.positionAt(offset);
    if (actual.line !== position.line || actual.character !== position.character) {
      return result;
    }
    const closer = closingTagAt(source, offset);
    if (closer === null) {
      return result;
    }
    return {
      _vs_textEditFormat: 2,
      _vs_textEdit: {
        range: { start: params._vs_position, end: params._vs_position },
        newText: '$0' + closer.replace(/[$}\\]/g, '\\$&'),
      },
    };
  });
  context.subscriptions.push(registration);
}
