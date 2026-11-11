import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exampleRoot, offsetAt, positionAt, rpcProcess, typescriptExecutable, type LspRange } from './rpc';

interface Diagnostic { code: number; range: LspRange }
interface Completion { label: string; insertText?: string; textEdit?: { newText: string; insert: LspRange; replace: LspRange } }

it('keeps diagnostics and applies completion edits beyond real unfinished quote/parenthesis edits', async () => {
  const app = readFileSync(new URL('../examples/task-board/App.auwla', import.meta.url), 'utf8');
  const versions = [
    { code: 1003, source: app.replace('"Make room for the next idea."', '"Make room for the next idea.') },
    { code: 1008, source: app.replace('aria-label=("Remove " + task.title)', 'aria-label=("Remove " + task.title') },
    { code: 1005, source: app.replace("let query = '';", "let query = ('';") },
  ];
  const uri = pathToFileURL(resolve(exampleRoot, 'App.auwla')).href;
  const peer = rpcProcess(typescriptExecutable, ['--lsp', '--stdio'], exampleRoot);
  peer.connection.onRequest('client/registerCapability', () => null);
  let revision = 1;

  try {
    await peer.connection.sendRequest('initialize', {
      processId: process.pid, rootUri: pathToFileURL(exampleRoot).href,
      capabilities: { textDocument: { completion: { completionItem: { insertReplaceSupport: true } }, diagnostic: {} } },
      initializationOptions: { runExternalCode: true },
    });
    await peer.connection.sendNotification('initialized', {});
    await peer.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'auwla', version: revision, text: app },
    });

    async function change(source: string) {
      await peer.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: ++revision }, contentChanges: [{ text: source }],
      });
      return peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', { textDocument: { uri } });
    }

    for (const version of versions) {
      const source = version.source.replace('<span>task.title</span>', '<span>task.ti</span>');
      const token = source.indexOf('<span>task.ti') + '<span>task.'.length;
      const range = { start: positionAt(source, token), end: positionAt(source, token + 2) };
      const report = await change(source);
      expect(report.items.some((item) => item.code === version.code)).toBe(true);
      expect(report.items.find((item) => item.code === 2339)?.range).toEqual(range);
      const completion = await peer.connection.sendRequest<{ items: Completion[] }>('textDocument/completion', {
        textDocument: { uri }, position: range.end,
      });
      const title = completion.items.find((item) => item.label === 'title');
      expect(title).toBeDefined();
      // LSP permits omitting textEdit for ordinary current-word insertion.
      // Exercise the native response as a client would; never call a client
      // default a server-provided edit.
      const replacement = title!.textEdit?.replace ?? range;
      expect(replacement).toEqual(range);
      const start = offsetAt(source, replacement.start);
      const end = offsetAt(source, replacement.end);
      const text = title!.textEdit?.newText ?? title!.insertText ?? title!.label;
      const edited = source.slice(0, start) + text + source.slice(end);
      const remaining = await change(edited);
      expect(remaining.items.some((item) => item.code === version.code)).toBe(true);
      expect(remaining.items.some((item) => item.code === 2339)).toBe(false);
      expect((await change(app)).items).toEqual([]);
    }
  } finally {
    await peer.close(true);
  }
}, 30000);
