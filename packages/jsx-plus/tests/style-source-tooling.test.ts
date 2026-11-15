import { expect, it } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { CompletionItem } from 'vscode-css-languageservice';
import { createCssSourceWorkspace, type CssSourceHost, type CssDirectoryEntry } from '../src/styles/sources/workspace';

const root = 'file:///app/App.auwla';
const theme = 'file:///app/Theme.auwla';
const use = '<style>@use("./Theme.auwla", "look"); .card {color:teal;}</style>';

function memory() {
  const files = new Map<string, string>([[theme, '<style id="look">.card {color:navy;}</style>']]);
  const reads: string[] = [];
  const host: CssSourceHost = {
    readFile(uri) {
      reads.push(uri);
      return files.get(uri);
    },
    readDirectory(uri) {
      const entries = new Map<string, CssDirectoryEntry>();
      for (const path of files.keys()) {
        if (!path.startsWith(uri)) {
          continue;
        }
        const rest = path.slice(uri.length);
        const segment = rest.split('/')[0]!;
        if (segment !== '') {
          const name = decodeURIComponent(segment);
          entries.set(name, { name, kind: rest.includes('/') ? 'directory' : 'file' });
        }
      }
      return [...entries.values()];
    },
  };
  return { files, reads, host, workspace: createCssSourceWorkspace(host) };
}

function applied(source: string, item: CompletionItem): string {
  if (item.textEdit === undefined || !('range' in item.textEdit)) {
    throw new Error('Expected a single authored replacement range');
  }
  return TextDocument.applyEdits(TextDocument.create(root, 'auwla', 0, source), [item.textEdit]);
}

it('completes relative source paths and IDs with safe applied edits and native CSS fallback', async () => {
  const { files, reads, workspace } = memory();
  files.set('file:///app/styles/Palette.auwla', '<style id="palette">.card {color:red;}</style>');
  files.set('file:///app/ignored.ts', 'export const ignored = 1;');
  const source = 'const emoji = "😀";\r\n<style>\r\n@use("./Th", "look");\r\n.card {color:re;}\r\n</style>';
  const session = (await workspace.session(source, root))!;
  const paths = await session.complete(source.indexOf('./Th') + 4);
  const item = paths!.items.find((item) => item.label === 'Theme.auwla')!;
  expect(item.textEdit).toMatchObject({ range: { start: { line: 2, character: 6 }, end: { line: 2, character: 10 } } });
  const completed = applied(source, item);
  expect(completed).toContain('@use("./Theme.auwla", "look")');
  const css = await session.complete(source.indexOf(':re') + 3);
  expect(css!.items.some((entry) => entry.label === 'red')).toBe(true);
  expect((await workspace.session(completed, root, 1))!.diagnostics()).toEqual([]);

  const folderSource = '<style>@use("./", "look");</style>';
  const folder = (await workspace.session(folderSource, root, 2))!;
  const choices = (await folder.complete(folderSource.indexOf('./') + 2))!.items;
  expect(choices.map((entry) => entry.label)).toEqual(['Theme.auwla', 'styles/']);
  expect(applied(folderSource, choices.find((entry) => entry.label === 'styles/')!)).toContain('"./styles/"');
  const idSource = '<style>@use("./Theme.auwla", "lo");</style>';
  const ids = (await workspace.session(idSource, root, 3))!;
  const look = (await ids.complete(idSource.indexOf('"lo') + 3))!.items[0]!;
  expect(applied(idSource, look)).toBe('<style>@use("./Theme.auwla", "look");</style>');
  expect(reads).not.toContain('file:///app/ignored.ts');
});

it('supports incomplete strings and CSS escapes while preserving quote style and surrounding host text', async () => {
  const { files, workspace } = memory();
  files.set('file:///app/Space%20%23%25.auwla', '<style id=\'say"hello\'>.card {color:red;}</style>');
  const source = String.raw`<style>@use('./Space\20 \23 \25 .auwla', 'say');</style>`;
  const session = (await workspace.session(source, root))!;
  const item = (await session.complete(source.indexOf("'say") + 4))!.items[0]!;
  expect(applied(source, item)).toContain(`'say"hello'`);

  const unfinished = '<style>@use("./Theme.auwla", "lo</style>\nconst untouched = 1;';
  const partial = (await workspace.session(unfinished, root, 1))!;
  const completed = applied(unfinished, (await partial.complete(unfinished.indexOf('"lo') + 3))!.items[0]!);
  expect(completed).toBe('<style>@use("./Theme.auwla", "look</style>\nconst untouched = 1;');
  const path = '<style>@use("./Th';
  const prefix = (await workspace.session(path, root, 2))!;
  expect(applied(path, (await prefix.complete(path.length))!.items[0]!)).toBe('<style>@use("./Theme.auwla');
  const escapedPath = String.raw`<style>@use("./Space\20", "look");</style>`;
  const escaped = (await workspace.session(escapedPath, root, 3))!;
  const candidate = (await escaped.complete(escapedPath.indexOf('\\20') + 3))!.items[0]!;
  expect(candidate.filterText).toStartWith(String.raw`./Space\20`);
  expect(applied(escapedPath, candidate)).toContain('"./Space #%.auwla"');
});

it('does not interpret literal uses in comments, strings, functions or nested style rules', async () => {
  const { workspace } = memory();
  for (const css of [
    '/* @use("./Theme.auwla", "look"); */',
    '.card {content:\'@use("./Theme.auwla", "look")\';}',
    '.card {--x:future(@use("./Theme.auwla", "look"));}',
    '.card {@use("./Theme.auwla", "look");}',
  ]) {
    const source = `<style>${css}</style>`;
    const session = (await workspace.session(source, root))!;
    const items = await session.complete(source.indexOf('"look') + 5);
    expect(items?.items.some((item) => item.label === 'look') ?? false).toBe(false);
  }
});

it('keeps direct missing-source and missing-ID diagnostics on the exact authored arguments', async () => {
  const { workspace } = memory();
  const source = 'const emoji = "😀";\r\n<style>\r\n  @use("./Missing.auwla", "look");\r\n</style>';
  const document = TextDocument.create(root, 'auwla', 0, source);
  const start = source.indexOf('./Missing.auwla');
  expect((await workspace.session(source, root))!.diagnostics()).toEqual([
    expect.objectContaining({ code: 'CSS3001', range: { start: document.positionAt(start), end: document.positionAt(start + './Missing.auwla'.length) } }),
  ]);
  const missing = use.replace('"look"', '"absent"');
  const missingStart = missing.indexOf('absent');
  expect((await workspace.session(missing, root, 1))!.diagnostics()).toEqual([
    expect.objectContaining({ code: 'CSS3001', message: expect.stringContaining('No named style "absent"'),
      range: { start: { line: 0, character: missingStart }, end: { line: 0, character: missingStart + 6 } } }),
  ]);
});

it('reports transitive problems and cycles with a related location in the defining source', async () => {
  const { files, workspace } = memory();
  const palette = 'file:///app/Palette.auwla';
  const definition = '<style id="look">\r\n  @use("./Palette.auwla", "absent");\r\n</style>';
  files.set(theme, definition);
  files.set(palette, '<style id="palette">.card {color:navy;}</style>');
  const problems = (await workspace.session(use, root))!.diagnostics();
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatchObject({
    code: 'CSS3001', message: expect.stringContaining('Imported style: No named style'),
    relatedInformation: [{ location: { uri: theme, range: { start: { line: 1, character: 27 }, end: { line: 1, character: 33 } } } }],
  });
  files.set(theme, definition.replace('absent', 'palette'));
  files.set(palette, '<style id="palette">@use("./Theme.auwla", "look");</style>');
  workspace.invalidate(palette);
  const cycle = (await workspace.session(use, root))!.diagnostics();
  expect(cycle[0]).toMatchObject({ message: expect.stringContaining('Cyclic style use'), relatedInformation: [{ location: { uri: palette } }] });
});

it('uses the shared validation for duplicate/malformed foreign declarations and never executes source JS', async () => {
  const { files, reads, workspace } = memory();
  files.set(theme, 'import "./must-not-load.ts"; throw Error("DO_NOT_EXECUTE");\n<style id="look">.card {color:navy;}</style>');
  expect((await workspace.session(use, root))!.diagnostics()).toEqual([]);
  expect(reads).toEqual([theme]);
  files.set(theme, '<style id="look">.card {color:navy;}</style><style id="look">.other {color:teal;}</style>');
  workspace.invalidate(theme);
  expect((await workspace.session(use, root))!.diagnostics()[0]).toMatchObject({
    message: expect.stringContaining('Duplicate style id'), relatedInformation: [{ location: { uri: theme } }],
  });
  files.set(theme, '<style scoped>.card {color:navy;}</style>');
  workspace.invalidate(theme);
  expect((await workspace.session(use, root))!.diagnostics()[0]).toMatchObject({
    code: 'CSS3001', relatedInformation: [{ location: { uri: theme } }],
  });
});

it('keeps duplicate local ID diagnostics at the authored style header', async () => {
  const { workspace } = memory();
  const block = '<style id="look">.card {color:navy;}</style>';
  const source = `${block}\r\n${block}`;
  const session = (await workspace.session(source, root))!;
  expect(session.diagnostics()).toEqual([
    expect.objectContaining({ code: 'CSS3001', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 17 } } }),
  ]);
});

it('anchors a transitive error to the selected definition rather than an unrelated use of the same file', async () => {
  const { workspace, files } = memory();
  files.set(theme, '<style id="quiet">.card {color:navy;}</style><style id="look">@use("./Missing.auwla", "missing");</style>');
  const source = '<style>@use("./Theme.auwla", "quiet"); @use("./Theme.auwla", "look");</style>';
  const document = TextDocument.create(root, 'auwla', 0, source);
  const start = source.lastIndexOf('@use');
  expect((await workspace.session(source, root))!.diagnostics()).toEqual([
    expect.objectContaining({ code: 'CSS3001', range: { start: document.positionAt(start), end: document.positionAt(source.indexOf(';', start) + 1) } }),
  ]);
});

it('refreshes cached consumers and ID suggestions after source edits, creation, deletion and close', async () => {
  const { files, reads, workspace } = memory();
  const first = workspace.session(use, root, 1);
  expect(workspace.session(use, root, 1)).toBe(first);
  const snapshot = (await first)!;
  await snapshot.complete(use.indexOf('"look') + 5);
  expect(reads).toEqual([theme]);
  files.delete(theme);
  expect(workspace.invalidate(theme)).toEqual([root]);
  expect(snapshot.isCurrent()).toBe(false);
  const missing = (await workspace.session(use, root, 1))!;
  expect(missing.diagnostics()[0]!.message).toContain('cannot resolve');
  files.set(theme, '<style id="look">.card {color:teal;}</style><style id="new-look">.card {color:blue;}</style>');
  expect(workspace.invalidate(theme)).toEqual([root]);
  expect((await workspace.session(use, root, 1))!.diagnostics()).toEqual([]);
  const idsSource = '<style>@use("./Theme.auwla", "");</style>';
  const ids = (await workspace.session(idsSource, root, 2))!;
  expect((await ids.complete(idsSource.indexOf('""') + 1))!.items.map((item) => item.label)).toEqual(['look', 'new-look']);
  workspace.close(root);
  expect(workspace.dependencies()).toEqual([]);
  expect(await ids.complete(idsSource.indexOf('""') + 1)).toBeUndefined();
});

it('prefers the passed unsaved root source and invalidates directory completion after file creation', async () => {
  const { files, workspace } = memory();
  files.set(root, '<style id="saved">.card {color:red;}</style>');
  const source = '<style id="unsaved">.card {color:teal;}</style><style>@use("./App.auwla", "un");</style>';
  const session = (await workspace.session(source, root))!;
  expect((await session.complete(source.indexOf('"un"') + 3))!.items.map((item) => item.label)).toEqual(['unsaved']);
  const pathSource = '<style>@use("./", "look");</style>';
  const paths = (await workspace.session(pathSource, root, 1))!;
  await paths.complete(pathSource.indexOf('./') + 2);
  files.set('file:///app/New.auwla', '<style id="new">.card {color:blue;}</style>');
  expect(workspace.invalidate('file:///app/New.auwla')).toEqual([root]);
  const refreshed = (await workspace.session(pathSource, root, 1))!;
  expect((await refreshed.complete(pathSource.indexOf('./') + 2))!.items.some((item) => item.label === 'New.auwla')).toBe(true);
});

it('supports injected aliases, defers unsupported aliases and reports reader failures without provider rejection', async () => {
  const { host, workspace } = memory();
  const source = use.replace('./Theme.auwla', '#theme');
  expect((await workspace.session(source, root))!.diagnostics()).toEqual([]);
  const aliases = createCssSourceWorkspace({ ...host, resolve: (specifier) => specifier === '#theme' ? theme : undefined });
  expect((await aliases.session(source, root))!.diagnostics()).toEqual([]);
  const broken = createCssSourceWorkspace({ ...host, readFile() { throw new Error('No permission to read'); } });
  expect((await broken.session(use, root))!.diagnostics()[0]!.message).toContain('No permission to read');
});

it('discards pending results after dependency changes and releases state on disposal', async () => {
  const { host, files } = memory();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  let release!: (value: string) => void;
  let first = true;
  const workspace = createCssSourceWorkspace({
    ...host,
    readFile(uri) {
      if (first) {
        first = false;
        started();
        return new Promise<string>((resolve) => { release = resolve; });
      }
      return files.get(uri);
    },
  });
  const pending = workspace.session(use, root);
  await reading;
  expect(workspace.invalidate(theme)).toEqual([root]);
  const latest = (await workspace.session(use, root))!;
  expect(latest.diagnostics()).toEqual([]);
  release('<style id="old">.card {color:red;}</style>');
  const stale = (await pending)!;
  expect(stale.isCurrent()).toBe(false);
  expect(await stale.complete(use.indexOf('"look') + 5)).toBeUndefined();
  workspace.clear();
  expect(latest.isCurrent()).toBe(false);
  expect(workspace.dependencies()).toEqual([]);
});

it('retains the single-file profile for untitled documents without a relative source base', async () => {
  const { workspace, reads } = memory();
  const uri = 'untitled:Untitled-1';
  const session = (await workspace.session(use, uri))!;
  expect(session.diagnostics()).toEqual([]);
  expect(reads).toEqual([]);
  expect(await session.complete(use.indexOf('"look"') + 1)).toBeUndefined();
  expect(workspace.invalidate(uri)).toEqual([uri]);
});
