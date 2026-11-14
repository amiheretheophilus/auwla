import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalize } from '../src/normalize';
import flow from './fixtures/checking-flow.json';
import { applyRename, documentUri, singleFileEdits, withLanguageServer, type CompletionItem, type WorkspaceEdit } from './lsp';
import { checkingRoot, offsetAt, positionAt, taskBoardRoot } from './rpc';

const taskBoard = readFileSync(resolve(taskBoardRoot, 'App.auwla'), 'utf8');

it('renames a real bare event handler through every authored use and rechecks', async () => {
  const file = resolve(taskBoardRoot, 'App.auwla');
  const uri = documentUri(taskBoardRoot, 'App.auwla');

  await withLanguageServer(taskBoardRoot, {}, async (server) => {
    await server.show(uri, taskBoard);
    const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri },
      position: positionAt(taskBoard, taskBoard.indexOf('onSubmit=addTask') + 'onSubmit='.length),
      newName: 'submitTask',
    });

    const edits = singleFileEdits(rename, file);
    expect(edits).toHaveLength(2);
    const renamed = applyRename(taskBoard, edits, 'addTask', 'submitTask');
    expect(renamed).toContain('onSubmit=submitTask');

    await server.show(uri, renamed);
    expect(await server.diagnostics(uri)).toEqual([]);
  });
}, 25000);

it('applies a native member-completion edit inside the real task-board parenthesized attribute', async () => {
  const source = taskBoard.replace('"Remove " + task.title', '"Remove " + task.ti');
  const token = source.indexOf('"Remove " + task.ti') + '"Remove " + task.'.length;
  const expectedRange = { start: positionAt(source, token), end: positionAt(source, token + 2) };
  const uri = documentUri(taskBoardRoot, 'App.auwla');

  await withLanguageServer(taskBoardRoot, { completion: { completionItem: { insertReplaceSupport: true } } }, async (server) => {
    await server.show(uri, source);
    const diagnostics = await server.diagnostics(uri);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 2339, range: expectedRange });

    const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
      textDocument: { uri }, position: expectedRange.end,
    });
    const title = completion.items.find((item) => item.label === 'title');
    expect(title?.textEdit).toEqual({ newText: 'title', insert: expectedRange, replace: expectedRange });
    const resolved = await server.request<CompletionItem>('completionItem/resolve', title);
    expect(resolved.detail).toContain('string');

    // Apply the server's actual edit to authored text, never a virtual TSX span.
    const edit = title!.textEdit!;
    const start = offsetAt(source, edit.replace.start);
    const end = offsetAt(source, edit.replace.end);
    const edited = source.slice(0, start) + edit.newText + source.slice(end);
    expect(edited).toBe(taskBoard);

    await server.show(uri, edited);
    expect(await server.diagnostics(uri)).toEqual([]);
  });
}, 25000);

it('gets authored diagnostics and safe ref rename edits from the real TypeScript language server', async () => {
  const file = resolve(checkingRoot, 'App.auwla');
  const uri = documentUri(checkingRoot, 'App.auwla');
  const source = readFileSync(file, 'utf8');

  await withLanguageServer(checkingRoot, { rename: { prepareSupport: true } }, async (server) => {
    expect(server.initialization.capabilities['renameProvider']).toBeTruthy();
    await server.show(uri, source);

    const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri }, position: positionAt(source, source.indexOf('input:')), newName: 'field',
    });
    const edits = singleFileEdits(rename, file);
    expect(edits).toHaveLength(4);
    const renamed = applyRename(source, edits, 'input', 'field');
    expect(normalize(renamed).code).toContain('ref={field}');
    expect(renamed).toContain('let field:');
    expect(renamed).toContain('field?.focus()');
    expect(renamed).toContain('field ? "Mounted"');
    await server.show(uri, renamed);
    expect(await server.diagnostics(uri)).toEqual([]);

    // Keep the surrogate pair on the same line before the error. LSP ranges
    // must describe authored UTF-16 positions, not virtual TSX or UTF-8 bytes.
    const broken = renamed.replace('title.toUpperCase()', 'title.toFixed(2)');
    await server.show(uri, broken);
    const error = (await server.diagnostics(uri)).find((item) => item.code === 2551);
    expect(error).toBeDefined();
    const start = broken.indexOf('toFixed');
    expect(error!.range).toEqual({ start: positionAt(broken, start), end: positionAt(broken, start + 7) });
    expect(error!.message).toContain('toFixed');

    await server.show(uri, '<p>"missing');
    const parseError = (await server.diagnostics(uri)).find((item) => item.message.includes('[JPX1003]'));
    expect(parseError).toBeDefined();
    expect(parseError!.range).toEqual({ start: { line: 0, character: 3 }, end: { line: 0, character: 4 } });

    await server.show(uri, renamed);
    expect(await server.diagnostics(uri)).toEqual([]);
  });
}, 25000);

it('renames a direct loop binding only within its loop', async () => {
  // The task board also has unrelated `task` parameters in filter callbacks.
  const file = resolve(taskBoardRoot, 'App.auwla');
  const uri = documentUri(taskBoardRoot, 'App.auwla');
  const source = readFileSync(file, 'utf8');
  const loopStart = source.indexOf('for (const task of visible)');
  const loopEnd = source.indexOf('</ul>', loopStart);
  const binding = loopStart + 'for (const '.length;

  await withLanguageServer(taskBoardRoot, {}, async (server) => {
    await server.show(uri, source);
    expect(await server.diagnostics(uri)).toEqual([]);
    const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri }, position: positionAt(source, binding), newName: 'row',
    });

    const edits = singleFileEdits(rename, file);
    const starts = edits.map((edit) => offsetAt(source, edit.range.start));
    expect(starts).toContain(binding);
    // Every use in the row, and nothing outside the loop. Uses are the binding
    // (`task of`) and member reads (`task.id`); this skips the comment's
    // backticked word and class names such as `task-toggle`.
    const usesInLoop = [...source.slice(loopStart, loopEnd).matchAll(/\btask(?=[.\s])/g)].length;
    expect(edits).toHaveLength(usesInLoop);
    expect(starts.every((start) => start >= loopStart && start < loopEnd)).toBe(true);

    const renamed = applyRename(source, edits, 'task', 'row');
    await server.show(uri, renamed);
    expect(await server.diagnostics(uri)).toEqual([]);
  });
}, 25000);

it('renames changing state through the primary view without supplemental edits', async () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-002')!.source;
  const file = resolve(checkingRoot, 'App.auwla');
  const uri = documentUri(checkingRoot, 'App.auwla');

  await withLanguageServer(checkingRoot, {}, async (server) => {
    await server.show(uri, source);
    const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri }, position: positionAt(source, source.indexOf('value:')), newName: 'current',
    });

    const edits = singleFileEdits(rename, file);
    expect(edits).toHaveLength(5);
    const renamed = applyRename(source, edits, 'value', 'current');

    await server.show(uri, renamed);
    expect(await server.diagnostics(uri)).toEqual([]);
    expect(renamed).not.toContain('void (() =>');
  });
}, 25000);
