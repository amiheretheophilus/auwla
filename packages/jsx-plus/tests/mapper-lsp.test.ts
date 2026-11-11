import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalize } from '../src/normalize';
import flow from './fixtures/checking-flow.json';
import { exampleRoot, offsetAt, positionAt, rpcProcess, typescriptExecutable, type LspRange, type TextEdit } from './rpc';

interface Diagnostic { code: number; message: string; range: LspRange }
interface Edit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: { textDocument: { uri: string }; edits: TextEdit[] }[];
}

it('gets authored diagnostics and safe ref rename edits from the real TypeScript language server', async () => {
  const file = resolve(exampleRoot, 'App.auwla');
  const uri = pathToFileURL(file).href;
  const source = readFileSync(file, 'utf8');
  const peer = rpcProcess(typescriptExecutable, ['--lsp', '--stdio'], exampleRoot);
  peer.connection.onRequest('client/registerCapability', () => null);
  try {
    const initialization = await peer.connection.sendRequest<{ capabilities: Record<string, unknown> }>('initialize', {
      processId: process.pid, rootUri: pathToFileURL(exampleRoot).href,
      capabilities: { general: { positionEncodings: ['utf-16'] },
        textDocument: { diagnostic: {}, rename: { prepareSupport: true } } },
      initializationOptions: { runExternalCode: true },
      workspaceFolders: [{ uri: pathToFileURL(exampleRoot).href, name: 'jsx-plus-probe' }],
    });
    expect(initialization.capabilities['renameProvider']).toBeTruthy();
    await peer.connection.sendNotification('initialized', {});
    await peer.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'auwla', version: 1, text: source },
    });

    const rename = await peer.connection.sendRequest<Edit>('textDocument/rename', {
      textDocument: { uri }, position: positionAt(source, source.indexOf('input:')), newName: 'field',
    });
    expect(rename).toBeTruthy();
    const entries = rename.documentChanges?.map((change) => [change.textDocument.uri, change.edits] as const)
      ?? Object.entries(rename.changes ?? {});
    expect(entries).toHaveLength(1);
    const returnedFile = fileURLToPath(entries[0]![0]);
    expect(process.platform === 'win32' ? returnedFile.toLowerCase() : returnedFile)
      .toBe(process.platform === 'win32' ? file.toLowerCase() : file);
    const edits = entries[0]![1];
    expect(edits).toHaveLength(4);
    let edited = source;
    const sorted = edits.map((edit) => ({ ...edit, start: offsetAt(source, edit.range.start), end: offsetAt(source, edit.range.end) }))
      .sort((a, b) => b.start - a.start);
    for (const edit of sorted) {
      expect(source.slice(edit.start, edit.end)).toBe('input');
      expect(edit.newText).toBe('field');
      edited = edited.slice(0, edit.start) + edit.newText + edited.slice(edit.end);
    }
    expect(normalize(edited).code).toContain('ref={field}');
    expect(edited).toContain('let field:');
    expect(edited).toContain('field?.focus()');
    expect(edited).toContain('field ? "Mounted"');
    await peer.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 }, contentChanges: [{ text: edited }],
    });
    const renamedDiagnostics = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', { textDocument: { uri } });
    expect(renamedDiagnostics.items).toEqual([]);

    // Keep the surrogate pair on the same line before the error. LSP ranges
    // must describe authored UTF-16 positions, not virtual TSX or UTF-8 bytes.
    const broken = edited.replace('title.toUpperCase()', 'title.toFixed(2)');
    await peer.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 3 }, contentChanges: [{ text: broken }],
    });
    const diagnostics = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', { textDocument: { uri } });
    const error = diagnostics.items.find((item) => item.code === 2551);
    expect(error).toBeDefined();
    const start = broken.indexOf('toFixed');
    expect(error!.range).toEqual({ start: positionAt(broken, start), end: positionAt(broken, start + 7) });
    expect(error!.message).toContain('toFixed');

    await peer.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 4 }, contentChanges: [{ text: '<p>"missing' }],
    });
    const incomplete = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', { textDocument: { uri } });
    const parseError = incomplete.items.find((item) => item.message.includes('[JPX1003]'));
    expect(parseError).toBeDefined();
    expect(parseError!.range).toEqual({ start: { line: 0, character: 3 }, end: { line: 0, character: 4 } });
    await peer.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 5 }, contentChanges: [{ text: edited }],
    });
    const restored = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', { textDocument: { uri } });
    expect(restored.items).toEqual([]);
  } finally {
    await peer.close(true);
  }
}, 25000);

it('renames changing state through the primary view without supplemental edits', async () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-002')!.source;
  const file = resolve(exampleRoot, 'App.auwla');
  const uri = pathToFileURL(file).href;
  const peer = rpcProcess(typescriptExecutable, ['--lsp', '--stdio'], exampleRoot);
  peer.connection.onRequest('client/registerCapability', () => null);

  try {
    await peer.connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(exampleRoot).href,
      capabilities: { textDocument: { diagnostic: {} } },
      initializationOptions: { runExternalCode: true },
    });
    await peer.connection.sendNotification('initialized', {});
    await peer.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'auwla', version: 1, text: source },
    });

    const rename = await peer.connection.sendRequest<Edit>('textDocument/rename', {
      textDocument: { uri },
      position: positionAt(source, source.indexOf('value:')),
      newName: 'current',
    });
    const entries = rename.documentChanges?.map((change) => [change.textDocument.uri, change.edits] as const)
      ?? Object.entries(rename.changes ?? {});

    expect(entries).toHaveLength(1);
    const returnedFile = fileURLToPath(entries[0]![0]);
    expect(process.platform === 'win32' ? returnedFile.toLowerCase() : returnedFile)
      .toBe(process.platform === 'win32' ? file.toLowerCase() : file);
    const edits = entries[0]![1];
    expect(edits).toHaveLength(5);

    let renamed = source;
    const positions = edits.map((edit) => ({
      start: offsetAt(source, edit.range.start),
      end: offsetAt(source, edit.range.end),
      text: edit.newText,
    })).sort((a, b) => b.start - a.start);

    for (const edit of positions) {
      expect(source.slice(edit.start, edit.end)).toBe('value');
      expect(edit.text).toBe('current');
      renamed = renamed.slice(0, edit.start) + edit.text + renamed.slice(edit.end);
    }

    await peer.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: renamed }],
    });
    const report = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', {
      textDocument: { uri },
    });
    expect(report.items).toEqual([]);
    expect(renamed).not.toContain('void (() =>');
  } finally {
    await peer.close(true);
  }
}, 25000);
