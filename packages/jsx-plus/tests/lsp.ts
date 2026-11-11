/**
 * A small client for the real TypeScript 7 language server, as the editor
 * integration tests use it: start in an example folder, show a document,
 * ask for diagnostics/completions/renames and apply the returned edits to
 * authored text.
 */
import { expect } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { offsetAt, rpcProcess, typescriptExecutable, type LspRange, type TextEdit } from './rpc';

export interface Diagnostic {
  code: number | string;
  message: string;
  range: LspRange;
  severity?: number;
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: { textDocument: { uri: string }; edits: TextEdit[] }[];
}

export interface CompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  labelDetails?: { description?: string };
  textEdit?: { newText: string; insert: LspRange; replace: LspRange };
  additionalTextEdits?: TextEdit[];
}

/** Apply LSP text edits to `source`, later edits first so earlier offsets stay valid. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const ordered = edits.map((edit) => ({
    start: offsetAt(source, edit.range.start), end: offsetAt(source, edit.range.end), text: edit.newText,
  })).sort((a, b) => b.start - a.start);

  let edited = source;
  for (const edit of ordered) {
    edited = edited.slice(0, edit.start) + edit.text + edited.slice(edit.end);
  }
  return edited;
}

export interface LanguageServer {
  readonly initialization: { capabilities: Record<string, unknown>; serverInfo: { version: string } };
  /** Open the document on first use, then replace its full text with a new version. */
  show(uri: string, text: string): Promise<void>;
  diagnostics(uri: string): Promise<Diagnostic[]>;
  request<T>(method: string, params: unknown): Promise<T>;
}

/** The file URI of `name` inside an example folder. */
export function documentUri(root: string, name: string): string {
  return pathToFileURL(resolve(root, name)).href;
}

/**
 * Run `body` against a fresh language server rooted at an example folder
 * (whose tsconfig registers the JSX+ mapper), then shut the server down.
 * `textDocument` adds client capabilities such as completion or rename;
 * pull diagnostics are always enabled.
 */
export async function withLanguageServer<T>(
  root: string, textDocument: Record<string, unknown>, body: (server: LanguageServer) => Promise<T>,
): Promise<T> {
  const peer = rpcProcess(typescriptExecutable, ['--lsp', '--stdio'], root);
  peer.connection.onRequest('client/registerCapability', () => null);
  // The server asks for each of `js/ts`, `typescript`, `javascript` and `editor`.
  // Answer like a default VS Code: auto-import suggestions on.
  peer.connection.onRequest('workspace/configuration', (params: { items: unknown[] }) => {
    return params.items.map(() => ({ suggest: { autoImports: true } }));
  });
  const versions = new Map<string, number>();

  try {
    const initialization = await peer.connection.sendRequest<LanguageServer['initialization']>('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        workspace: { configuration: true },
        general: { positionEncodings: ['utf-16'] },
        textDocument: { diagnostic: {}, ...textDocument },
      },
      initializationOptions: { runExternalCode: true },
    });
    await peer.connection.sendNotification('initialized', {});

    return await body({
      initialization,
      async show(uri, text) {
        const version = (versions.get(uri) ?? 0) + 1;
        versions.set(uri, version);
        if (version === 1) {
          await peer.connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: 'auwla', version, text },
          });
        } else {
          await peer.connection.sendNotification('textDocument/didChange', {
            textDocument: { uri, version }, contentChanges: [{ text }],
          });
        }
      },
      async diagnostics(uri) {
        const report = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', {
          textDocument: { uri },
        });
        return report.items;
      },
      request: (method, params) => peer.connection.sendRequest(method, params),
    });
  } finally {
    await peer.close(true);
  }
}

/** The edits a workspace edit makes, asserting it touches exactly `file`. */
export function singleFileEdits(edit: WorkspaceEdit, file: string): TextEdit[] {
  const entries = edit.documentChanges?.map((change) => [change.textDocument.uri, change.edits] as const)
    ?? Object.entries(edit.changes ?? {});
  expect(entries).toHaveLength(1);

  // Windows paths compare case-insensitively.
  const normalizeCase = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  expect(normalizeCase(fileURLToPath(entries[0]![0]))).toBe(normalizeCase(file));
  return entries[0]![1];
}

/**
 * Apply rename edits to authored `source`, asserting each replaces exactly
 * `oldName` with `newName`. Returns the renamed source.
 */
export function applyRename(source: string, edits: readonly TextEdit[], oldName: string, newName: string): string {
  for (const edit of edits) {
    expect(source.slice(offsetAt(source, edit.range.start), offsetAt(source, edit.range.end))).toBe(oldName);
    expect(edit.newText).toBe(newName);
  }
  return applyEdits(source, edits);
}
