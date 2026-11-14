import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyEdits, applyRename, documentUri, singleFileEdits, withLanguageServer,
  type CompletionItem, type WorkspaceEdit } from './lsp';
import { packageRoot, positionAt } from './rpc';

it('completes, hovers and renames authored references inside quoted interpolation', async () => {
  const appsRoot = resolve(packageRoot, 'tests/fixtures/apps');
  const source = readFileSync(resolve(appsRoot, 'counter.auwla'), 'utf8');
  expect(source).toContain('"Count: {count}"');
  const uri = documentUri(appsRoot, 'counter.auwla');

  await withLanguageServer(appsRoot, {
    completion: { completionItem: { insertReplaceSupport: true } },
    rename: { prepareSupport: true },
  }, async (server) => {
    const partial = source.replace('{count}', '{cou}');
    const start = partial.indexOf('{cou}') + 1;
    const range = { start: positionAt(partial, start), end: positionAt(partial, start + 3) };
    await server.show(uri, partial);
    expect((await server.diagnostics(uri)).find((item) => item.code === 2304)?.range).toEqual(range);

    const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
      textDocument: { uri }, position: range.end,
    });
    const count = completion.items.find((item) => item.label === 'count');
    expect(count).toBeDefined();
    const edit = count!.textEdit;
    const edited = applyEdits(partial, [{
      range: edit?.replace ?? range,
      newText: edit?.newText ?? count!.insertText ?? count!.label,
    }]);
    expect(edited).toBe(source);
    await server.show(uri, edited);
    expect(await server.diagnostics(uri)).toEqual([]);

    // Start an interpolation with no expression yet. The checking view keeps
    // the slot for native recovery; strict compilation still rejects it.
    const empty = source.replace('{count}', '{}');
    await server.show(uri, empty);
    const emptyCompletion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
      textDocument: { uri }, position: positionAt(empty, empty.indexOf('{}') + 1),
    });
    expect(emptyCompletion.items.some((item) => item.label === 'count')).toBe(true);

    for (const unfinished of ['{cou"', '{cou']) {
      const damaged = source.replace('{count}"', unfinished);
      const name = damaged.indexOf('{cou') + 1;
      await server.show(uri, damaged);
      expect((await server.diagnostics(uri)).some((item) => item.code === 1012)).toBe(true);
      const result = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
        textDocument: { uri }, position: positionAt(damaged, name + 3),
      });
      expect(result.items.some((item) => item.label === 'count')).toBe(true);
    }

    await server.show(uri, edited);

    const expression = edited.indexOf('{count}') + 1;
    const hover = await server.request<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri }, position: positionAt(edited, expression),
    });
    expect(hover.contents.value).toContain('count: number');

    const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri }, position: positionAt(edited, expression), newName: 'total',
    });
    const edits = singleFileEdits(rename, resolve(appsRoot, 'counter.auwla'));
    expect(edits).toHaveLength(3);
    const renamed = applyRename(edited, edits, 'count', 'total');
    expect(renamed).toContain('"Count: {total}"');
    await server.show(uri, renamed);
    expect(await server.diagnostics(uri)).toEqual([]);
  });
}, 30000);
