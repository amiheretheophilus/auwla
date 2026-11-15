import { expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { applyEdits, documentUri, withLanguageServer, type CompletionItem } from './lsp';
import { positionAt } from './rpc';
import { closingTagAt } from '../src/editor/tags';

const root = resolve(import.meta.dir, 'fixtures/apps/checking');

it('applies native intrinsic and component completions to unfinished tags, preserving unrelated type errors', async () => {
  await withLanguageServer(root, {
    completion: { completionItem: { insertReplaceSupport: true } },
  }, async (server) => {
    const uri = documentUri(root, 'App.auwla');
    for (const [tag, label] of [['d', 'div'], ['But', 'Button']] as const) {
      for (const parent of ['', '<section>']) {
        for (const suffix of ['', '\n);\n}\nexport const after: string = 123;', ';\n}\nexport const after: string = 123;']) {
          const parenthesis = suffix.startsWith(';') ? '' : '(';
          const source = 'export function Button() { return <button />; }\nexport function App() {\n  return '
            + parenthesis + parent + '<' + tag + suffix;
          const cursor = source.lastIndexOf('<' + tag) + tag.length + 1;
          await server.show(uri, source);
          const diagnostics = await server.diagnostics(uri);
          expect(diagnostics.some((item) => item.code === 1999)).toBe(true);
          expect(diagnostics.some((item) => item.code === 18080)).toBe(false);
          if (suffix !== '') {
            expect(diagnostics.some((item) => item.code === 2322)).toBe(true);
          }
          const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
            textDocument: { uri }, position: positionAt(source, cursor),
          });
          const item = completion.items.find((entry) => entry.label === label);
          expect(item, source).toBeDefined();
          const range = item!.textEdit?.replace ?? {
            start: positionAt(source, cursor - tag.length), end: positionAt(source, cursor),
          };
          const edited = applyEdits(source, [{ range, newText: item!.textEdit?.newText ?? item!.insertText ?? item!.label }]);
          expect(edited).toBe(source.slice(0, cursor - tag.length) + label + source.slice(cursor));

          // Finish the actual authored tag and enclosing markup, rather than
          // accepting an error-free virtual tree as evidence of a valid file.
          const insertion = edited.lastIndexOf('<' + label) + label.length + 1;
          const completed = edited.slice(0, insertion) + ' />' + (parent === '' ? '' : '</section>')
            + (suffix === '' ? ');\n}' : edited.slice(insertion));
          await server.show(uri, completed);
          expect((await server.diagnostics(uri)).map((item) => item.code)).toEqual(suffix === '' ? [] : [2322]);
        }
      }
    }
  });
}, 30000);

it('checks tag-closing proposals against native mapped auto-insert and a clean recheck', async () => {
  await withLanguageServer(root, {}, async (server) => {
    const uri = documentUri(root, 'App.auwla');
    for (const tag of ['<div>', '<>']) {
      const source = 'export function App() {\n  return (' + tag + '\n);\n}';
      const cursor = source.indexOf(tag) + tag.length;
      const position = positionAt(source, cursor);
      await server.show(uri, source);
      const diagnostics = await server.diagnostics(uri);
      expect(diagnostics).toEqual([expect.objectContaining({ code: 1002 })]);
      const native = await server.request('textDocument/_vs_onAutoInsert', {
        _vs_textDocument: { uri }, _vs_position: position, _vs_ch: '>',
      });
      // The checking-only closers are already present in virtual TSX. The
      // editor middleware supplies the shared authored-source proposal instead.
      expect(native).toBeNull();
      const closer = closingTagAt(source, cursor);
      expect(closer).toBe(tag === '<>' ? '</>' : '</div>');
      const completed = applyEdits(source, [{ range: { start: position, end: position }, newText: closer! }]);
      await server.show(uri, completed);
      expect(await server.diagnostics(uri)).toEqual([]);
      expect(closingTagAt(completed, cursor)).toBeNull();
    }
  });
}, 30000);
