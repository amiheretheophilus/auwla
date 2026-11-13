import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyEdits, applyRename, documentUri, singleFileEdits, withLanguageServer,
  type CompletionItem, type WorkspaceEdit } from './lsp';
import { packageRoot, positionAt } from './rpc';

const exampleRoot = resolve(packageRoot, 'examples');
const greeting = readFileSync(resolve(exampleRoot, 'greeting.auwla'), 'utf8');

it('applies native completion edits inside unfinished template expressions and headers', async () => {
  const uri = documentUri(exampleRoot, 'greeting.auwla');
  await withLanguageServer(exampleRoot, {
    completion: { completionItem: { insertReplaceSupport: true } },
    rename: { prepareSupport: true },
  }, async (server) => {
    await server.show(uri, greeting);
    expect(await server.diagnostics(uri)).toEqual([]);

    for (const [complete, partial, marker, member] of [
      ['if (name.length > 0)', 'if (name.)', 'if (name.', 'length'],
      ['if (name.length > 0)', 'if (name?. > 0)', 'if (name?.', 'length'],
      ['name.trim().length === 0', 'name.trim(). === 0', 'name.trim().', 'length'],
      ['of model.rows', 'of model.', 'of model.', 'rows'],
      ['title=(name.toUpperCase())', 'title=(name.())', 'title=(name.', 'toUpperCase'],
      ['title={row.toUpperCase()}', 'title={row.()}', 'title={row.', 'toUpperCase'],
      ['>row.toUpperCase()</li>', '>row.()</li>', '>row.', 'toUpperCase'],
      [': name.toLowerCase()', ': name.()', ': name.', 'toLowerCase'],
      ['{name.toUpperCase()}"', '{name.()}"', '{name.', 'toUpperCase'],
      ['event.currentTarget.value', 'event.currentTarget.', 'event.currentTarget.', 'value'],
    ] as const) {
      expect(greeting).toContain(complete);
      const source = greeting.replace(complete, partial);
      const cursor = source.indexOf(marker) + marker.length;
      await server.show(uri, source);
      const diagnostics = await server.diagnostics(uri);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((item) => item.message.includes('[JPX'))).toBe(false);

      const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
        textDocument: { uri }, position: positionAt(source, cursor),
      });
      const item = completion.items.find((entry) => entry.label === member);
      expect(item, marker).toBeDefined();
      const edit = item!.textEdit;
      const edited = applyEdits(source, [{
        range: edit?.replace ?? { start: positionAt(source, cursor), end: positionAt(source, cursor) },
        newText: edit?.newText ?? item!.insertText ?? item!.label,
      }]);
      const expected = greeting.replace(complete, partial.replace(marker, marker + member));
      expect(edited).toBe(expected);
      await server.show(uri, edited);
      expect(await server.diagnostics(uri)).toEqual([]);
    }

    // A missing operand needs scope completion, rather than member completion.
    for (const partial of ['if ()', 'if (name &&)']) {
      const source = greeting.replace('if (name.length > 0)', partial);
      const cursor = source.indexOf(partial) + partial.length - 1;
      await server.show(uri, source);
      expect((await server.diagnostics(uri)).length).toBeGreaterThan(0);
      const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
        textDocument: { uri }, position: positionAt(source, cursor),
      });
      const name = completion.items.find((entry) => entry.label === 'name');
      expect(name).toBeDefined();
      expect(completion.items.some((entry) => entry.label === 'row')).toBe(false);
      const edit = name!.textEdit;
      const edited = applyEdits(source, [{
        range: edit?.replace ?? { start: positionAt(source, cursor), end: positionAt(source, cursor) },
        newText: edit?.newText ?? name!.insertText ?? name!.label,
      }]);
      expect(edited).toBe(greeting.replace('if (name.length > 0)', partial.replace(')', 'name)')));
      await server.show(uri, edited);
      expect(await server.diagnostics(uri)).toEqual([]);
    }

    const emptyLoop = greeting.replace('of model.rows', 'of ');
    const iterableCursor = emptyLoop.indexOf('of )') + 'of '.length;
    await server.show(uri, emptyLoop);
    const iterables = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
      textDocument: { uri }, position: positionAt(emptyLoop, iterableCursor),
    });
    const iterable = iterables.items.find((entry) => entry.label === 'name');
    expect(iterable).toBeDefined();
    const iterableEdit = iterable!.textEdit;
    const loop = applyEdits(emptyLoop, [{
      range: iterableEdit?.replace ?? { start: positionAt(emptyLoop, iterableCursor), end: positionAt(emptyLoop, iterableCursor) },
      newText: iterableEdit?.newText ?? iterable!.insertText ?? iterable!.label,
    }]);
    expect(loop).toBe(greeting.replace('of model.rows', 'of name'));
    await server.show(uri, loop);
    // Completing to the string makes the old model unused. Preserve that
    // native hint; there must be no syntax, iterable or row-type error.
    expect(await server.diagnostics(uri)).toEqual([
      expect.objectContaining({ code: 6133, severity: 4 }),
    ]);

    const partial = greeting.replace('if (name.length > 0)', 'if (name.)');
    const reference = partial.indexOf('if (name.') + 'if ('.length;
    await server.show(uri, partial);
    const hover = await server.request<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri }, position: positionAt(partial, reference),
    });
    expect(hover.contents.value).toContain('name: string');
    const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri }, position: positionAt(partial, reference), newName: 'displayName',
    });
    const renamed = applyRename(partial, singleFileEdits(rename, resolve(exampleRoot, 'greeting.auwla')), 'name', 'displayName');
    expect(renamed).toContain('if (displayName.)');
    expect(renamed).toContain('let displayName');
    expect(renamed).toContain('Enter a name.');
    await server.show(uri, renamed);
    const remaining = await server.diagnostics(uri);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.some((entry) => entry.code === 2304 || entry.message.includes('[JPX'))).toBe(false);
  });
}, 30000);
