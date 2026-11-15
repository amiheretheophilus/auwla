import { beforeEach, expect, it, mock } from 'bun:test';
import { resolve } from 'node:path';
import type { ExtensionContext } from 'vscode';
import type * as VSCode from 'vscode';
import type { ContentMapperContribution, TypeScriptSDK } from 'typescript/vscode';
import { auwlaLanguage } from '@memoized-dom/jsx-plus/editor';
import manifest from '../package.json';
import { waitFor } from '../../../test-support/helpers';

const messages: string[] = [];
const lines: string[] = [];
const commands: string[] = [];
let chosenAction: string | undefined;
let workspaceDirectories: string[] = [];
let provider: { activate(): Promise<unknown> } | undefined;
let completionProvider: VSCode.CompletionItemProvider | undefined;
let hoverProvider: VSCode.HoverProvider | undefined;
let opened: ((document: VSCode.TextDocument) => void) | undefined;
const changeListeners: ((event: VSCode.TextDocumentChangeEvent) => void)[] = [];
const changed = (event: VSCode.TextDocumentChangeEvent) => { for (const listener of changeListeners) listener(event); };
const closeListeners: ((document: VSCode.TextDocument) => void)[] = [];
const closed = (document: VSCode.TextDocument) => { for (const listener of closeListeners) listener(document); };
let decorationStyle: VSCode.DecorationRenderOptions | undefined;
let visibleEditors: VSCode.TextEditor[] = [];
let shownEditors: ((editors: readonly VSCode.TextEditor[]) => void) | undefined;
let configured: ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined;
const settings = new Map<string, unknown>();
const cssDiagnostics = new Map<string, readonly VSCode.Diagnostic[]>();
const disposable = () => ({ dispose() {} });
let filesystem = false;
let openDocuments: VSCode.TextDocument[] = [];
const sourceFiles = new Map<string, string>();
let sourceReader: ((uri: string) => Promise<Uint8Array>) | undefined;
interface WatchedDirectory {
  readonly uri: string;
  disposed: boolean;
  create?: (uri: VSCode.Uri) => void;
  change?: (uri: VSCode.Uri) => void;
  delete?: (uri: VSCode.Uri) => void;
}
const watchedDirectories: WatchedDirectory[] = [];

function uri(value: string): VSCode.Uri {
  return { toString: () => value, path: new URL(value).pathname } as VSCode.Uri;
}

function fileEvent(kind: 'create' | 'change' | 'delete', value: string): void {
  for (const watcher of watchedDirectories) {
    if (!watcher.disposed && watcher.uri === new URL('./', value).href) {
      watcher[kind]?.(uri(value));
    }
  }
}

mock.module('vscode', () => ({
  Uri: { parse: uri },
  FileType: { File: 1, Directory: 2 },
  CompletionItemKind: { Folder: 18 },
  RelativePattern: class { constructor(public baseUri: VSCode.Uri, public pattern: string) {} },
  Location: class { constructor(public uri: VSCode.Uri, public range: VSCode.Range) {} },
  DiagnosticRelatedInformation: class { constructor(public location: VSCode.Location, public message: string) {} },
  Range: class {
    start: { line: number; character: number };
    end: { line: number; character: number };
    constructor(line: number, character: number, endLine: number, endCharacter: number) {
      this.start = { line, character };
      this.end = { line: endLine, character: endCharacter };
    }
  },
  CompletionItem: class { constructor(public label: string, public kind: number) {} },
  CompletionList: class { constructor(public items: unknown[], public isIncomplete: boolean) {} },
  MarkdownString: class { constructor(public value = '') {} },
  SnippetString: class { constructor(public value: string) {} },
  TextEdit: class { constructor(public range: unknown, public newText: string) {} },
  Hover: class { constructor(public contents: unknown[], public range: unknown) {} },
  Diagnostic: class { constructor(public range: unknown, public message: string, public severity: number) {} },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  ThemeColor: class { constructor(public id: string) {} },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri: VSCode.Uri, entries: readonly VSCode.Diagnostic[]) => cssDiagnostics.set(uri.toString(), entries),
      delete: (uri: VSCode.Uri) => cssDiagnostics.delete(uri.toString()),
      dispose() {},
    }),
    registerCompletionItemProvider: (_selector: unknown, value: VSCode.CompletionItemProvider) => {
      completionProvider = value;
      return disposable();
    },
    registerHoverProvider: (_selector: unknown, value: VSCode.HoverProvider) => {
      hoverProvider = value;
      return disposable();
    },
  },
  window: {
    createTextEditorDecorationType: (options: VSCode.DecorationRenderOptions) => {
      decorationStyle = options;
      return { dispose() {} };
    },
    get visibleTextEditors() { return visibleEditors; },
    onDidChangeVisibleTextEditors: (listener: typeof shownEditors) => { shownEditors = listener; return disposable(); },
    createOutputChannel: () => ({ appendLine: (line: string) => lines.push(line), dispose() {} }),
    showWarningMessage: async (message: string) => {
      messages.push(message);
      return chosenAction;
    },
  },
  commands: { executeCommand: async (command: string) => { commands.push(command); } },
  extensions: {
    getExtension: (id: string) => {
      expect(id).toBe('TypeScriptTeam.native-preview');
      return provider;
    },
  },
  workspace: {
    get textDocuments() { return openDocuments; },
    get fs() {
      return filesystem ? {
        async readFile(path: VSCode.Uri) {
          if (sourceReader !== undefined) {
            return sourceReader(path.toString());
          }
          const source = sourceFiles.get(path.toString());
          if (source === undefined) {
            throw Object.assign(new Error('Missing source'), { code: 'FileNotFound' });
          }
          return new TextEncoder().encode(source);
        },
        async readDirectory(path: VSCode.Uri) {
          const entries = new Map<string, number>();
          for (const key of sourceFiles.keys()) {
            if (key.startsWith(path.toString())) {
              const relative = key.slice(path.toString().length);
              entries.set(decodeURIComponent(relative.split('/')[0]!), relative.includes('/') ? 2 : 1);
            }
          }
          return [...entries];
        },
      } : undefined;
    },
    createFileSystemWatcher(pattern: { baseUri: VSCode.Uri }) {
      const watched: WatchedDirectory = { uri: pattern.baseUri.toString(), disposed: false };
      watchedDirectories.push(watched);
      return {
        onDidCreate(listener: (uri: VSCode.Uri) => void) { watched.create = listener; return disposable(); },
        onDidChange(listener: (uri: VSCode.Uri) => void) { watched.change = listener; return disposable(); },
        onDidDelete(listener: (uri: VSCode.Uri) => void) { watched.delete = listener; return disposable(); },
        dispose() { watched.disposed = true; },
      };
    },
    getConfiguration: (section: string) => ({
      get: <T>(key: string, fallback: T) => (settings.get(`${section}.${key}`) as T | undefined) ?? fallback,
    }),
    onDidChangeConfiguration: (listener: typeof configured) => { configured = listener; return disposable(); },
    onDidOpenTextDocument: (listener: typeof opened) => { opened = listener; return disposable(); },
    // Like closing: every provider listens, and `changed` tells them all.
    onDidChangeTextDocument: (listener: (event: VSCode.TextDocumentChangeEvent) => void) => {
      changeListeners.push(listener);
      return disposable();
    },
    // Every provider listens for closing, as in VS Code; `closed` tells them all.
    onDidCloseTextDocument: (listener: (document: VSCode.TextDocument) => void) => {
      closeListeners.push(listener);
      return disposable();
    },
    get workspaceFolders() {
      return workspaceDirectories.map((fsPath) => ({ uri: { scheme: 'file', fsPath } }));
    },
  },
}));

const { activate } = await import('../src/extension');

beforeEach(() => {
  messages.length = 0;
  lines.length = 0;
  commands.length = 0;
  chosenAction = undefined;
  provider = undefined;
  workspaceDirectories = [];
  cssDiagnostics.clear();
  completionProvider = undefined;
  hoverProvider = undefined;
  decorationStyle = undefined;
  visibleEditors = [];
  settings.clear();
  filesystem = false;
  openDocuments = [];
  sourceFiles.clear();
  sourceReader = undefined;
  watchedDirectories.length = 0;
});

function context() {
  return {
    extensionPath: resolve(import.meta.dirname, '..'),
    extension: { id: `${manifest.publisher}.${manifest.name}` },
    subscriptions: [],
  } as unknown as ExtensionContext;
}

it('keeps the declarative language registration aligned with the shared metadata', () => {
  const language = manifest.contributes.languages[0]!;
  expect(language.id).toBe(auwlaLanguage.id);
  expect(language.extensions).toEqual([...auwlaLanguage.extensions]);
  expect(manifest.contributes.grammars[0]!.scopeName).toBe(auwlaLanguage.scopeName);
});

it('explains a missing TypeScript host while leaving highlighting declarative', async () => {
  const session = context();
  await activate(session);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('TypeScriptTeam.native-preview');
  expect(messages[0]).toContain('Syntax highlighting is still available');
  expect(session.subscriptions.length).toBeGreaterThan(1);
  expect(completionProvider).toBeDefined();
  expect(hoverProvider).toBeDefined();
});

it('shows reactivity hints beside declarations, without the TypeScript host, and follows its setting', async () => {
  let text ='export function Counter() {\n  let count = 0;\n  const doubled = count * 2;\n  return <button onClick={() => count++}>doubled</button>;\n}\n';
  const offsetAt = (position: VSCode.Position) => text.split('\n').slice(0, position.line)
    .reduce((length, line) => length + line.length + 1, 0) + position.character;
  const positionAt = (offset: number) => {
    const lines = text.slice(0, offset).split('\n');
    return { line: lines.length - 1, character: lines.at(-1)!.length };
  };
  const document = {
    uri: { toString: () => 'file:///Counter.auwla', path: '/Counter.auwla' },
    languageId: 'auwla', version: 1, getText: () => text, offsetAt, positionAt,
  } as unknown as VSCode.TextDocument;
  let painted: readonly VSCode.DecorationOptions[] | undefined;
  const editor = { document, setDecorations: (_style: unknown, options: VSCode.DecorationOptions[]) => { painted = options; } };
  visibleEditors = [editor as unknown as VSCode.TextEditor];
  const shown = () => painted!.map((decoration): unknown[] => [
    decoration.range.start, decoration.range.end, decoration.renderOptions!.after!.contentText,
  ]);

  // The open editor is painted at activation: `: label` after each declared name.
  await activate(context());
  expect(shown()).toEqual([
    [{ line: 1, character: 6 }, { line: 1, character: 11 }, ': state'],
    [{ line: 2, character: 8 }, { line: 2, character: 15 }, ': derived ← count'],
  ]);
  expect((painted![1]!.hoverMessage as VSCode.MarkdownString).value)
    .toBe('**Derived** from `count`\n\n`doubled` is recomputed when `count` changes: `count * 2` runs again.');

  // Its own colors, contributed with theme defaults, not the inlay-hint color shared with comments.
  const after = decorationStyle!.after!;
  expect([(after.color as VSCode.ThemeColor).id, (after.backgroundColor as VSCode.ThemeColor).id])
    .toEqual(['auwla.reactivityHint.foreground', 'auwla.reactivityHint.background']);
  expect(manifest.contributes.colors.map((color) => color.id)).toEqual(['auwla.reactivityHint.foreground', 'auwla.reactivityHint.background']);

  // An edit repaints once typing pauses.
  text = text.replace('count * 2', 'count * 2 + bonus').replace('let count = 0;', 'let count = 0;\n  let bonus = 1;')
    .replace('() => count++', '() => { count++; bonus++; }');
  (document as { version: number }).version = 2;
  changed({ document } as VSCode.TextDocumentChangeEvent);
  await Bun.sleep(250);
  expect(shown().map((entry) => entry[2])).toEqual([': state', ': state', ': derived ← count, bonus']);

  // Turning the setting off clears them; a newly shown editor follows it too.
  settings.set('auwla.reactivityHints', false);
  configured!({ affectsConfiguration: (section) => section === 'auwla.reactivityHints' });
  expect(painted).toEqual([]);
  settings.set('auwla.reactivityHints', true);
  shownEditors!([editor as unknown as VSCode.TextEditor]);
  expect(painted).toHaveLength(3);
});

it('provides CSS edits, hover and live diagnostics independently of the TypeScript host', async () => {
  await activate(context());
  let text = '<style global>\n.card { padding: 4px; unknown-property: red; }\n</style>\nconst host = 1;';
  const document = {
    uri: { toString: () => 'file:///style.auwla' },
    languageId: 'auwla',
    version: 1,
    getText: () => text,
    offsetAt: (position: VSCode.Position) => text.split('\n').slice(0, position.line)
      .reduce((length, line) => length + line.length + 1, 0) + position.character,
  } as VSCode.TextDocument;
  opened!(document);
  expect(cssDiagnostics.get(document.uri.toString())).toContainEqual(expect.objectContaining({
    source: 'Auwla CSS', code: 'unknownProperties', range: expect.objectContaining({ start: { line: 1, character: 22 } }),
  }));
  const token = {} as VSCode.CancellationToken;
  const position = { line: 1, character: 12 } as VSCode.Position;
  const result = await completionProvider!.provideCompletionItems(document, position, token, {} as VSCode.CompletionContext);
  const list = result as VSCode.CompletionList;
  const padding = list.items.find((item) => item.label === 'padding');
  expect(padding?.range).toMatchObject({ start: { line: 1, character: 8 } });
  const hover = await hoverProvider!.provideHover(document, position, token);
  expect(hover?.contents.length).toBeGreaterThan(0);
  expect(await completionProvider!.provideCompletionItems(document, { line: 3, character: 6 } as VSCode.Position,
    token, {} as VSCode.CompletionContext)).toBeUndefined();

  text = text.replace('unknown-property: red;', 'color: red;');
  Object.assign(document, { version: 2 });
  changed({ document } as VSCode.TextDocumentChangeEvent);
  expect(cssDiagnostics.get(document.uri.toString())).toEqual([]);
  closed!(document);
  expect(cssDiagnostics.has(document.uri.toString())).toBe(false);
});

function sourceDocument(path: string, initial: string) {
  let text = initial;
  const document = {
    uri: uri(path), languageId: 'auwla', version: 1,
    getText: () => text,
    offsetAt(position: VSCode.Position) {
      return text.split('\n').slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character;
    },
    positionAt(offset: number) {
      const lines = text.slice(0, offset).split('\n');
      return { line: lines.length - 1, character: lines.at(-1)!.length } as VSCode.Position;
    },
  } as unknown as VSCode.TextDocument;
  return { document, edit(value: string) {
    text = value;
    Object.assign(document, { version: document.version + 1 });
  } };
}

it('completes style sources and refreshes imports after outside-workspace saves, unsaved edits and close', async () => {
  filesystem = true;
  const path = 'file:///app/Card.auwla';
  const theme = 'file:///shared/Theme.auwla';
  const saved = '<style id="look">.card {color:navy;}</style>';
  sourceFiles.set(theme, saved);
  sourceFiles.set('file:///shared/styles/Other.auwla', '<style id="other">.card {color:blue;}</style>');
  const source = '<style>@use("../shared/Theme.auwla", "look"); .card {color:re;}</style>';
  const { document } = sourceDocument(path, source);
  openDocuments = [document];
  const session = context();
  await activate(session);
  const token = {} as VSCode.CancellationToken;
  const complete = async (offset: number) => await completionProvider!.provideCompletionItems(
    document, document.positionAt(offset), token, {} as VSCode.CompletionContext,
  ) as VSCode.CompletionList;

  const ids = await complete(source.indexOf('"look"') + 1);
  expect(ids.items.map((item) => item.label)).toEqual(['look']);
  expect(ids.items[0]!.range).toMatchObject({ start: { line: 0, character: source.indexOf('look') } });
  const paths = await complete(source.indexOf('../shared/') + '../shared/'.length);
  expect(paths.items.some((item) => item.label === 'Theme.auwla')).toBe(true);
  expect(paths.items.find((item) => item.label === 'styles/')?.command?.command).toBe('editor.action.triggerSuggest');
  expect(watchedDirectories.some((watcher) => watcher.uri === 'file:///shared/' && !watcher.disposed)).toBe(true);
  expect((await complete(source.indexOf(':re') + 3)).items.some((item) => item.label === 'red')).toBe(true);

  sourceFiles.delete(theme);
  fileEvent('delete', theme);
  await waitFor(() => expect(cssDiagnostics.get(path)?.some((problem) => problem.code === 'CSS3001')).toBe(true));
  sourceFiles.set(theme, saved);
  fileEvent('create', theme);
  await waitFor(() => expect(cssDiagnostics.get(path)).toEqual([]));
  expect(document.version).toBe(1);

  const foreign = sourceDocument(theme, saved);
  openDocuments.push(foreign.document);
  foreign.edit('<style id="live">.card {color:teal;}</style>');
  changed({ document: foreign.document } as VSCode.TextDocumentChangeEvent);
  await waitFor(() => expect(cssDiagnostics.get(path)?.some((problem) => problem.message.includes('No named style "look"'))).toBe(true));
  expect((await complete(source.indexOf('"look"') + 1)).items.map((item) => item.label)).toEqual(['live']);
  openDocuments = [document];
  closed(foreign.document);
  await waitFor(() => expect(cssDiagnostics.get(path)).toEqual([]));

  sourceFiles.set(theme, '<style id="look">@use("./Palette.auwla", "missing");</style>');
  sourceFiles.set('file:///shared/Palette.auwla', '<style id="palette">.card {color:navy;}</style>');
  fileEvent('change', theme);
  await waitFor(() => expect(cssDiagnostics.get(path)?.[0]?.relatedInformation?.[0]?.location.uri.toString()).toBe(theme));
  openDocuments = [];
  closed(document);
  expect(cssDiagnostics.has(path)).toBe(false);
  expect(watchedDirectories.every((watcher) => watcher.disposed)).toBe(true);
  for (const subscription of session.subscriptions) {
    subscription.dispose();
  }
});

it('drops stale source completions and diagnostics after removing the use while a read is pending', async () => {
  filesystem = true;
  let notify!: () => void;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  let release!: (value: Uint8Array) => void;
  sourceReader = () => {
    notify();
    return new Promise<Uint8Array>((resolve) => { release = resolve; });
  };
  const path = 'file:///app/Slow.auwla';
  const initial = '<style>@use("./Theme.auwla", "look");</style>';
  const { document, edit } = sourceDocument(path, initial);
  openDocuments = [document];
  const session = context();
  await activate(session);
  const pending = completionProvider!.provideCompletionItems(document,
    document.positionAt(initial.indexOf('look')), {} as VSCode.CancellationToken, {} as VSCode.CompletionContext);
  await started;
  edit('<style>.card {color:teal;}</style>');
  changed({ document } as VSCode.TextDocumentChangeEvent);
  release(new TextEncoder().encode('<style id="outdated">.card {color:red;}</style>'));
  expect(await pending).toBeUndefined();
  expect(cssDiagnostics.get(path)).toEqual([]);
  expect(watchedDirectories.every((watcher) => watcher.disposed)).toBe(true);
  for (const subscription of session.subscriptions) {
    subscription.dispose();
  }
});

it('keeps untitled CSS documents editable before they have a relative source directory', async () => {
  filesystem = true;
  const initial = '<style>@use("./Theme.auwla", "look");</style>';
  const { document, edit } = sourceDocument('untitled:Untitled-1', initial);
  openDocuments = [document];
  const session = context();
  await activate(session);
  const result = await completionProvider!.provideCompletionItems(document,
    document.positionAt(initial.indexOf('look')), {} as VSCode.CancellationToken, {} as VSCode.CompletionContext);
  expect(result).toBeUndefined();
  expect(cssDiagnostics.get(document.uri.toString())).toEqual([]);
  edit('<style>.card {color:teal;}</style>');
  changed({ document } as VSCode.TextDocumentChangeEvent);
  expect(cssDiagnostics.get(document.uri.toString())).toEqual([]);
  expect(watchedDirectories).toEqual([]);
  for (const subscription of session.subscriptions) {
    subscription.dispose();
  }
});

it('rejects an incompatible extension API with a useful message', async () => {
  provider = { activate: async () => ({}) };
  await activate(context());
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('does not expose content-mapper registration');
});

it('reports host activation failures without throwing an unhandled activation error', async () => {
  provider = { activate: async () => { throw new Error('Host failed to start'); } };
  await activate(context());
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Host failed to start');
});

it('registers the installed shared package and gives disposal to the editor', async () => {
  const registrations: { id: string; contributions: readonly ContentMapperContribution[] }[] = [];
  const disposable = { dispose: mock(() => {}) };
  provider = {
    activate: async () => ({
      registerContentMappers(id: string, contributions: readonly ContentMapperContribution[]) {
        registrations.push({ id, contributions });
        return disposable;
      },
    }),
  };
  const session = context();
  // Simulate an installed extension outside the checkout. A mapper can only be
  // found through the open task-board project, not through the extension path.
  Object.assign(session, { extensionPath: resolve(process.env.TEMP ?? '/', 'auwla-installed-adapter') });
  workspaceDirectories = [resolve(import.meta.dirname, 'fixtures/apps/task-board')];
  await activate(session);
  expect(messages).toEqual([]);
  expect(registrations).toHaveLength(1);
  expect(registrations[0]!.id).toBe(session.extension.id);
  const contribution = registrations[0]!.contributions[0]!;
  expect(contribution.extensions).toEqual(['.auwla']);
  expect(contribution.inferredProjectContribution!.manifest.cwd!.fsPath)
    .toBe(resolve(import.meta.dirname, '../../jsx-plus'));
  expect(session.subscriptions).toContain(disposable);
  for (const subscription of session.subscriptions) {
    subscription.dispose();
  }
  expect(disposable.dispose).toHaveBeenCalledTimes(1);
});

for (const version of ['7.0.2', '7.1.0-beta']) {
  it(`reports the actual SDK and explains unsupported server ${version}`, async () => {
    const events = { dispose: mock(() => {}) };
    provider = {
      activate: async () => ({
        registerContentMappers: () => ({ dispose() {} }),
        onLanguageServerInitialized(listener: (sdk: TypeScriptSDK) => void) {
          // The real API immediately notifies listeners when already running.
          listener({ version } as TypeScriptSDK);
          return events;
        },
      }),
    };
    chosenAction = 'Select Workspace SDK';
    const session = context();
    await activate(session);
    expect(lines).toContain(`TypeScript language server SDK: ${version}`);
    expect(session.subscriptions).toContain(events);
    if (version === '7.0.2') {
      expect(messages).toEqual([expect.stringContaining('selected server is 7.0.2')]);
      expect(commands).toEqual(['typescript.native-preview.selectVersion']);
    } else {
      expect(messages).toEqual([]);
      expect(commands).toEqual([]);
    }
  });
}
