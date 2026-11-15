import * as vscode from 'vscode';
import { createCssSession } from '@memoized-dom/jsx-plus/styles';
import { createCssSourceWorkspace, sourceDirectory } from '@memoized-dom/jsx-plus/styles/sources';
import { createEditorCssSourceHost } from './css/sources';

type CssSession = ReturnType<typeof createCssSession>;
type ProtocolRange = { start: { line: number; character: number }; end: { line: number; character: number } };

function range(value: ProtocolRange): vscode.Range {
  return new vscode.Range(value.start.line, value.start.character, value.end.line, value.end.character);
}

/** CSS providers do not depend on the TypeScript extension or its selected SDK. */
export function registerCss(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('auwla-css');
  const sessions = new Map<string, { version: number; session: CssSession }>();
  const validations = new Map<string, object>();
  const watchers = new Map<string, vscode.Disposable>();
  let disposed = false;
  const host = createEditorCssSourceHost(trackSource);
  const sources = host === undefined ? undefined : createCssSourceWorkspace(host);

  function directory(uri: string): string | undefined {
    return uri.endsWith('/') ? uri : sourceDirectory(uri);
  }

  function trackSource(uri: string): void {
    if (disposed || sources === undefined || !sources.dependencies().includes(uri)
      || typeof vscode.workspace.createFileSystemWatcher !== 'function' || vscode.RelativePattern === undefined) {
      return;
    }
    const parent = directory(uri);
    if (parent === undefined || watchers.has(parent)) {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.parse(parent), '*.auwla'));
    const listeners = [watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh)];
    watchers.set(parent, {
      dispose() {
        for (const listener of listeners) {
          listener.dispose();
        }
        watcher.dispose();
      },
    });
  }

  function pruneWatchers(): void {
    const active = new Set(sources?.dependencies().map(directory).filter((uri): uri is string => uri !== undefined));
    for (const [uri, watcher] of watchers) {
      if (!active.has(uri)) {
        watcher.dispose();
        watchers.delete(uri);
      }
    }
  }

  function revalidate(uris: readonly string[], except?: string): void {
    for (const document of vscode.workspace.textDocuments) {
      const key = document.uri.toString();
      if (key !== except && uris.includes(key)) {
        validate(document);
      }
    }
  }

  function refresh(uri: vscode.Uri): void {
    revalidate(sources?.invalidate(uri.toString()) ?? []);
  }

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

  function publish(document: vscode.TextDocument, problems: ReturnType<NonNullable<CssSession>['diagnostics']>): void {
    diagnostics.set(document.uri, problems.map((problem) => {
      const severity = problem.severity === 1 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      const diagnostic = new vscode.Diagnostic(range(problem.range), problem.message, severity);
      diagnostic.source = 'Auwla CSS';
      diagnostic.code = problem.code;
      if (problem.relatedInformation !== undefined) {
        diagnostic.relatedInformation = problem.relatedInformation.map((related) => new vscode.DiagnosticRelatedInformation(
          new vscode.Location(vscode.Uri.parse(related.location.uri), range(related.location.range)), related.message,
        ));
      }
      return diagnostic;
    }));
  }

  function validate(document: vscode.TextDocument): void {
    if (disposed || document.languageId !== 'auwla') {
      return;
    }
    const key = document.uri.toString();
    const ticket = {};
    validations.set(key, ticket);
    const current = session(document);
    publish(document, current?.diagnostics() ?? []);
    if (sources !== undefined && current?.hasUses) {
      const version = document.version;
      void sources.session(document.getText(), key, version).then((prepared) => {
        if (!disposed && validations.get(key) === ticket && document.version === version && prepared?.isCurrent()) {
          publish(document, prepared.diagnostics());
          pruneWatchers();
        }
      }).catch((error: unknown) => console.error('Auwla CSS source validation failed', error));
    } else {
      sources?.close(key);
      pruneWatchers();
    }
  }

  function changed(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const affected = sources?.invalidate(key) ?? [];
    validate(document);
    revalidate(affected, key);
  }

  context.subscriptions.push(
    diagnostics,
    { dispose() {
      disposed = true;
      sessions.clear();
      validations.clear();
      sources?.clear();
      for (const watcher of watchers.values()) {
        watcher.dispose();
      }
      watchers.clear();
    } },
    vscode.workspace.onDidOpenTextDocument(changed),
    vscode.workspace.onDidChangeTextDocument((event) => changed(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const affected = sources?.invalidate(key) ?? [];
      sources?.close(key);
      validations.delete(key);
      sessions.delete(key);
      diagnostics.delete(document.uri);
      revalidate(affected, key);
      pruneWatchers();
    }),
    vscode.languages.registerCompletionItemProvider('auwla', {
      async provideCompletionItems(document, position, token) {
        const current = session(document);
        const version = document.version;
        const prepared = current?.hasUses && sources !== undefined
          ? await sources.session(document.getText(), document.uri.toString(), version) : undefined;
        const result = prepared === undefined ? current?.complete(document.offsetAt(position))
          : await prepared.complete(document.offsetAt(position));
        if (disposed || token?.isCancellationRequested || document.version !== version || (prepared !== undefined && !prepared.isCurrent())) {
          return undefined;
        }
        pruneWatchers();
        if (result === undefined) {
          return undefined;
        }
        const items = result.items.map((item) => {
          const completion = new vscode.CompletionItem(item.label,
            item.kind === undefined ? undefined : item.kind - 1);
          completion.detail = item.detail;
          completion.sortText = item.sortText;
          completion.filterText = item.filterText;
          if (completion.kind === vscode.CompletionItemKind.Folder) {
            completion.command = { title: 'Complete style path', command: 'editor.action.triggerSuggest' };
          }
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
    }, ':', '-', ' ', '"', "'", '/', ','),
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
