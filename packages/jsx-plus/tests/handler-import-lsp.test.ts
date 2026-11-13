import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyEdits, documentUri, withLanguageServer, type CompletionItem, type Diagnostic } from './lsp';
import { positionAt, taskBoardRoot } from './rpc';

const taskBoard = readFileSync(resolve(taskBoardRoot, 'App.auwla'), 'utf8');
// A branch checkout may use CRLF. Match the authored import, including its
// newline, so the test actually removes it before requesting an auto-import.
const lineEnding = taskBoard.includes('\r\n') ? '\r\n' : '\n';
const importStatement = "import { focusTaskInput } from './actions';";
const importLine = importStatement + lineEnding;
// This LSP client uses TypeScript's default LF for newly generated imports.
// Existing authored lines must retain their checkout line endings unchanged.
const generatedImport = importStatement + '\n';
const completedTaskBoard = taskBoard.replace(importLine, generatedImport);

/**
 * P3-HANDLER-IMPORT: start from the real task board without the handler's
 * import, half-type the bare handler, accept TypeScript's completion with its
 * auto-import edit, and arrive back at the authored file.
 */
for (const [name, typed, complete] of [
  ['bare attribute', 'onClick=focusTask', 'onClick=focusTaskInput'],
  ['child expression', '<span>focusTask</span>', '<span>focusTaskInput</span>'],
] as const) {
  it(`completes and auto-imports a handler at the end of a ${name}`, async () => {
    expect(taskBoard).toContain(importLine);
    const withoutImport = taskBoard.replace(importLine, '');
    // The child case keeps the original attribute so only one name is unresolved.
    const target = name === 'bare attribute' ? withoutImport.replace('onClick=focusTaskInput', typed)
      : withoutImport.replace('onClick=focusTaskInput', 'onClick=(() => {})').replace('<span>task.title</span>', typed);
    const expected = name === 'bare attribute' ? completedTaskBoard
      : completedTaskBoard.replace('onClick=focusTaskInput', 'onClick=(() => {})').replace('<span>task.title</span>', complete);
    const uri = documentUri(taskBoardRoot, 'App.auwla');
    const cursor = target.indexOf(typed) + typed.indexOf('focusTask') + 'focusTask'.length;

    await withLanguageServer(taskBoardRoot, {
      completion: { completionItem: { insertReplaceSupport: true, resolveSupport: { properties: ['additionalTextEdits'] } } },
    }, async (server) => {
      await server.show(uri, target);
      const missing = (await server.diagnostics(uri)).filter((item: Diagnostic) => item.code === 2304);
      expect(missing).toHaveLength(1);

      const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
        textDocument: { uri }, position: positionAt(target, cursor),
      });
      const item = completion.items.find((entry) => entry.label === 'focusTaskInput');
      expect(item?.labelDetails?.description).toBe('./actions');

      const resolved = await server.request<CompletionItem>('completionItem/resolve', item);
      expect(resolved.additionalTextEdits).toHaveLength(1);
      expect(resolved.additionalTextEdits![0]!.newText).toBe(generatedImport);

      // Apply the identifier edit and the import edit together, as a client does.
      const edit = resolved.textEdit!;
      const edited = applyEdits(target, [{ range: edit.replace, newText: edit.newText }, ...resolved.additionalTextEdits!]);
      expect(edited).toBe(expected);

      await server.show(uri, edited);
      const remaining = (await server.diagnostics(uri)).map((item) => item.code);
      // A handler rendered as a child is a genuine type error (TS2322, not a
      // valid Child); what matters here is that the name now resolves.
      expect(remaining).toEqual(name === 'bare attribute' ? [] : [2322]);
    });
  }, 30000);
}
