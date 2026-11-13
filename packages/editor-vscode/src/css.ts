import * as vscode from 'vscode';
import { createCssSession } from '@memoized-dom/jsx-plus/styles';

type CssSession = ReturnType<typeof createCssSession>;
type ProtocolRange = { start: { line: number; character: number }; end: { line: number; character: number } };

function range(value: ProtocolRange): vscode.Range {
  return new vscode.Range(value.start.line, value.start.character, value.end.line, value.end.character);
}

/** CSS providers do not depend on the TypeScript extension or its selected SDK. */
export function registerCss(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('auwla-css');
  const sessions = new Map<string, { version: number; session: CssSession }>();

  function session(document: vscode.TextDocument): CssSession {
    const key = document.uri.toString();
    const cached = sessions.get(key);
    if (cached?.version === document.version) {
      return cached.session;
    }
    const current = createCssSession(document.getText(), key, document.version);
    sessions.set(key, { version: document.version, session: current });
    return current;
  }

  function validate(document: vscode.TextDocument): void {
    if (document.languageId !== 'auwla') {
      return;
    }
    const problems = session(document)?.diagnostics() ?? [];
    diagnostics.set(document.uri, problems.map((problem) => {
      const severity = problem.severity === 1 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      const diagnostic = new vscode.Diagnostic(range(problem.range), problem.message, severity);
      diagnostic.source = 'Auwla CSS';
      diagnostic.code = problem.code;
      return diagnostic;
    }));
  }

  context.subscriptions.push(
    diagnostics,
    { dispose: () => sessions.clear() },
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((event) => validate(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      sessions.delete(document.uri.toString());
      diagnostics.delete(document.uri);
    }),
    vscode.languages.registerCompletionItemProvider('auwla', {
      provideCompletionItems(document, position) {
        const result = session(document)?.complete(document.offsetAt(position));
        if (result === undefined) {
          return undefined;
        }
        const items = result.items.map((item) => {
          const completion = new vscode.CompletionItem(item.label,
            item.kind === undefined ? undefined : item.kind - 1);
          completion.detail = item.detail;
          completion.sortText = item.sortText;
          completion.filterText = item.filterText;
          completion.documentation = typeof item.documentation === 'string'
            ? item.documentation
            : item.documentation === undefined ? undefined : new vscode.MarkdownString(item.documentation.value);

          const text = item.textEdit?.newText ?? item.insertText;
          if (text !== undefined) {
            completion.insertText = item.insertTextFormat === 2 ? new vscode.SnippetString(text) : text;
          }
          if (item.textEdit !== undefined) {
            completion.range = 'range' in item.textEdit ? range(item.textEdit.range) : range(item.textEdit.replace);
          }
          completion.additionalTextEdits = item.additionalTextEdits?.map((edit) =>
            new vscode.TextEdit(range(edit.range), edit.newText));
          return completion;
        });
        return new vscode.CompletionList(items, result.isIncomplete);
      },
    }, ':', '-', ' '),
    vscode.languages.registerHoverProvider('auwla', {
      provideHover(document, position) {
        const result = session(document)?.hover(document.offsetAt(position));
        if (result == null) {
          return undefined;
        }
        const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
        const markdown = contents.map((content) => {
          if (typeof content === 'string') {
            return new vscode.MarkdownString(content);
          }
          if ('language' in content) {
            return new vscode.MarkdownString().appendCodeblock(content.value, content.language);
          }
          return new vscode.MarkdownString(content.value);
        });
        return new vscode.Hover(markdown, result.range === undefined ? undefined : range(result.range));
      },
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    validate(document);
  }
}
