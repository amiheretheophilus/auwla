/**
 * Rename and completion across `.auwla` modules, through the real TypeScript 7 language server.
 * `fixtures/cross-file` has a component and a helper in `Badge.auwla`, used by two `.auwla`
 * files and a `.ts` file. Each edit is applied to the authored text and every file is checked
 * again, as an editor would.
 */
import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits, applyRename, documentUri, withLanguageServer, type CompletionItem, type LanguageServer, type WorkspaceEdit } from './lsp';
import { offsetAt, positionAt, type TextEdit } from './rpc';

const root = fileURLToPath(new URL('./fixtures/cross-file/', import.meta.url));
const FILES = ['Badge.auwla', 'App.auwla', 'Page.auwla', 'main.ts'] as const;
type File = typeof FILES[number];
const authored = Object.fromEntries(FILES.map((name) => [name, readFileSync(resolve(root, name), 'utf8')])) as Record<File, string>;
const uri = (name: File) => documentUri(root, name);

async function openAll(server: LanguageServer): Promise<void> {
  for (const name of FILES) await server.show(uri(name), authored[name]);
}

/** A workspace edit's text edits by file name. Windows paths compare case-insensitively. */
function editsByFile(edit: WorkspaceEdit): Map<string, TextEdit[]> {
  const entries = edit.documentChanges?.map((change) => [change.textDocument.uri, change.edits] as const)
    ?? Object.entries(edit.changes ?? {});
  return new Map(entries.map(([target, edits]) => [resolve(fileURLToPath(target)).toLowerCase(), edits]));
}

const completionCapabilities = {
  completion: { completionItem: { insertReplaceSupport: true, resolveSupport: { properties: ['additionalTextEdits'] } } },
};

for (const [what, file, declaration, oldName, newName, uses] of [
  ['a component', 'Badge.auwla', 'Badge(', 'Badge', 'Label', { 'Badge.auwla': 1, 'App.auwla': 2, 'Page.auwla': 2 }],
  ['a function, into a .ts file too', 'Badge.auwla', 'shout(', 'shout', 'yell', { 'Badge.auwla': 1, 'App.auwla': 2, 'main.ts': 2 }],
] as const) {
  it(`renames ${what} from its declaration in every file that imports it`, async () => {
    await withLanguageServer(root, {}, async (server) => {
      await openAll(server);
      const rename = await server.request<WorkspaceEdit>('textDocument/rename', {
        textDocument: { uri: uri(file) },
        position: positionAt(authored[file], authored[file].indexOf(declaration)),
        newName,
      });

      const edits = editsByFile(rename);
      const touched = Object.fromEntries(FILES.flatMap((name) => {
        const fileEdits = edits.get(resolve(root, name).toLowerCase());
        return fileEdits === undefined ? [] : [[name, fileEdits.length]];
      }));
      expect(touched).toEqual(uses);

      // Each edit replaces exactly the authored name; the renamed project checks clean.
      for (const name of FILES) {
        const fileEdits = edits.get(resolve(root, name).toLowerCase());
        if (fileEdits === undefined) continue;
        await server.show(uri(name), applyRename(authored[name], fileEdits, oldName, newName));
      }
      for (const name of FILES) expect(await server.diagnostics(uri(name))).toEqual([]);
    });
  }, 30000);
}

/** Ask for completion at the end of `typed` in `source` and resolve the item labelled `label`. */
async function complete(server: LanguageServer, source: string, typed: string, label: string) {
  await server.show(uri('Page.auwla'), source);
  const cursor = source.indexOf(typed) + typed.length;
  const completion = await server.request<{ items: CompletionItem[] } | null>('textDocument/completion', {
    textDocument: { uri: uri('Page.auwla') }, position: positionAt(source, cursor),
  });
  const item = completion?.items.find((entry) => entry.label === label);
  expect(item).toBeDefined();
  return server.request<CompletionItem>('completionItem/resolve', item);
}

/** The completion's own edit and its import edit, applied together as a client does. */
function accept(source: string, item: CompletionItem): string {
  const own = item.textEdit === undefined ? [] : [{ range: item.textEdit.replace, newText: item.textEdit.newText }];
  return applyEdits(source, [...own, ...item.additionalTextEdits ?? []]);
}

const withoutImport = authored['Page.auwla'].replace(/import \{ Badge \} from '\.\/Badge\.auwla';\r?\n/, '');

it('completes a component from another .auwla file while its tag is being typed, adding the import', async () => {
  // `<Badg` before `</section>` is an opening tag still being typed; recovery closes it for
  // checking only, so TypeScript completes the tag name and imports it.
  const typing = withoutImport.replace('<Badge label="page" />', '<Badg');
  expect(typing).not.toContain('import');
  await withLanguageServer(root, completionCapabilities, async (server) => {
    await openAll(server);
    const item = await complete(server, typing, '<Badg', 'Badge');
    expect(item.labelDetails?.description).toBe('./Badge.auwla');
    // The import names the extension (DX-40), as relative `.auwla` imports must.
    expect(item.additionalTextEdits?.map((edit) => edit.newText)).toEqual(["import { Badge } from './Badge.auwla';\n"]);

    // With no text edit, a client replaces the typed word with the label. Then the author
    // finishes the tag, and the file is the authored one again (the new import uses LF).
    const word = typing.indexOf('<Badg') + 1;
    const named = { range: { start: positionAt(typing, word), end: positionAt(typing, word + 'Badg'.length) }, newText: 'Badge' };
    const accepted = item.textEdit === undefined ? applyEdits(typing, [named, ...item.additionalTextEdits!]) : accept(typing, item);
    const finished = accepted.replace('<Badge</section>', '<Badge label="page" /></section>');
    expect(finished).toBe(authored['Page.auwla'].replace(/^(import[^\n]*?)\r?\n/, '$1\n'));
    await server.show(uri('Page.auwla'), finished);
    expect(await server.diagnostics(uri('Page.auwla'))).toEqual([]);
  });
}, 30000);

for (const [where, typing, typed, imported] of [
  // The file already imports from `./Badge.auwla`: that import gains the name.
  ['an attribute expression', authored['Page.auwla'].replace('label="page"', "label={shou('page')}"), 'label={shou',
    "import { Badge, shout } from './Badge.auwla';"],
  // It imports nothing yet: a new import, naming the extension (DX-40).
  ['a child expression', withoutImport.replace('<Badge label="page" />', "<b>; shou('page')</b>"), '; shou',
    "import { shout } from './Badge.auwla';"],
] as const) {
  it(`completes a function from another .auwla file in ${where}, importing it`, async () => {
    await withLanguageServer(root, completionCapabilities, async (server) => {
      await openAll(server);
      const item = await complete(server, typing, typed, 'shout');
      expect(item.labelDetails?.description).toBe('./Badge.auwla');
      const accepted = accept(typing, item);
      expect(accepted.startsWith(imported)).toBe(true);
      expect(accepted).toContain(typed.replace('shou', 'shout'));

      await server.show(uri('Page.auwla'), accepted);
      expect(await server.diagnostics(uri('Page.auwla'))).toEqual([]);
    });
  }, 30000);
}

it('places TypeScript variable type hints on the authored names', async () => {
  // Faint inferred types (`count: number`), as the editor shows them, mapped back to `.auwla`.
  const counter = 'export function Counter() {\n  let count = 0;\n  const doubled = count * 2;\n'
    + '  return <p><button onClick={() => count++}>"+"</button>; doubled</p>;\n}\n';
  await withLanguageServer(root, { inlayHint: {} }, async (server) => {
    await openAll(server);
    await server.show(uri('Page.auwla'), counter);
    const hints = await server.request<{ position: { line: number; character: number }; label: { value: string }[] }[]>(
      'textDocument/inlayHint', { textDocument: { uri: uri('Page.auwla') }, range: { start: positionAt(counter, 0), end: positionAt(counter, counter.length) } });
    const shown = hints.map((hint) => [counter.slice(0, offsetAt(counter, hint.position)).split(/\s/).at(-1), hint.label.map((part) => part.value).join('')]);
    expect(shown).toEqual([['count', ': number'], ['doubled', ': number']]);
  }, { inlayHints: { variableTypes: { enabled: true } } });
}, 30000);

it("completes a member of a .auwla module's namespace", async () => {
  const typing = authored['Page.auwla']
    .replace("import { Badge } from './Badge.auwla';", "import * as badges from './Badge.auwla';")
    .replace('<Badge label="page" />', "<badges.Badge label={badges.sh('page')} />");
  await withLanguageServer(root, completionCapabilities, async (server) => {
    await openAll(server);
    const item = await complete(server, typing, 'badges.sh', 'shout');
    const accepted = accept(typing, item);
    expect(accepted).toContain("label={badges.shout('page')}");
    await server.show(uri('Page.auwla'), accepted);
    expect(await server.diagnostics(uri('Page.auwla'))).toEqual([]);
  });
}, 30000);
