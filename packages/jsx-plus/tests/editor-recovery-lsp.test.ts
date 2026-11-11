import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { documentUri, withLanguageServer, type CompletionItem } from './lsp';
import { offsetAt, positionAt, taskBoardRoot } from './rpc';

it('keeps diagnostics and applies completions around unfinished task-board edits', async () => {
  const app = readFileSync(resolve(taskBoardRoot, 'App.auwla'), 'utf8');
  const damagedLabel = (source: string) => source.replace('aria-label=("Remove " + task.title)', 'aria-label=("Remove " + task.title');
  const brokenHost = (source: string) => source.replace("let query = '';", "let query = ('';");
  const versions: { codes: number[]; source: string; target?: 'attribute' }[] = [
    { codes: [1003], source: app.replace('"Make room for the next idea."', '"Make room for the next idea.') },
    { codes: [1008], source: damagedLabel(app) },
    { codes: [1005], source: brokenHost(app) },
    // Damaged markup (JSX+ 1008) beside an ordinary host error (TypeScript 1005).
    { codes: [1008, 1005], source: damagedLabel(brokenHost(app)) },
    { codes: [1001], source: app.replace('        </ul>\n', '') },
    { codes: [1001], source: app.replace('      </footer>', '      </fo') },
    { codes: [1999], source: app.replace('onInput={event => query = event.currentTarget.value}', 'onInput={event => query = event.currentTarget.value') },
    { codes: [1011], source: app.replace('for (const task of visible) {', 'for (const task of visible {') },
    { codes: [1008], source: damagedLabel(app), target: 'attribute' },
  ];
  const uri = documentUri(taskBoardRoot, 'App.auwla');

  await withLanguageServer(taskBoardRoot, { completion: { completionItem: { insertReplaceSupport: true } } }, async (server) => {
    async function change(source: string) {
      await server.show(uri, source);
      return server.diagnostics(uri);
    }
    await server.show(uri, app);

    for (const version of versions) {
      // Most cases complete a member elsewhere. The attribute case completes
      // the very expression whose closing parenthesis is missing.
      const marker = version.target === 'attribute' ? 'aria-label=("Remove " + task.' : '<span>task.';
      const source = version.source.replace(`${marker}title`, `${marker}ti`);
      const token = source.indexOf(`${marker}ti`) + marker.length;
      const range = { start: positionAt(source, token), end: positionAt(source, token + 2) };
      const report = await change(source);
      for (const code of version.codes) expect(report.some((item) => item.code === code)).toBe(true);
      expect(report.find((item) => item.code === 2339)?.range).toEqual(range);

      const completion = await server.request<{ items: CompletionItem[] }>('textDocument/completion', {
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
      for (const code of version.codes) expect(remaining.some((item) => item.code === code)).toBe(true);
      expect(remaining.some((item) => item.code === 2339)).toBe(false);
      expect(await change(app)).toEqual([]);
    }
  });
}, 30000);
