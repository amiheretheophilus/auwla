import { beforeEach, expect, it, mock } from 'bun:test';
import { resolve } from 'node:path';
import type { ExtensionContext } from 'vscode';
import type * as VSCode from 'vscode';
import type { ContentMapperContribution, TypeScriptSDK } from 'typescript/vscode';
import { auwlaLanguage } from '@memoized-dom/jsx-plus/editor';
import manifest from '../package.json';

const messages: string[] = [];
const lines: string[] = [];
const commands: string[] = [];
let chosenAction: string | undefined;
let workspaceDirectories: string[] = [];
let provider: { activate(): Promise<unknown> } | undefined;
let completionProvider: VSCode.CompletionItemProvider | undefined;
let hoverProvider: VSCode.HoverProvider | undefined;
let opened: ((document: VSCode.TextDocument) => void) | undefined;
let changed: ((event: VSCode.TextDocumentChangeEvent) => void) | undefined;
let closed: ((document: VSCode.TextDocument) => void) | undefined;
const cssDiagnostics = new Map<string, readonly VSCode.Diagnostic[]>();
const disposable = () => ({ dispose() {} });

mock.module('vscode', () => ({
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
    textDocuments: [],
    onDidOpenTextDocument: (listener: typeof opened) => { opened = listener; return disposable(); },
    onDidChangeTextDocument: (listener: typeof changed) => { changed = listener; return disposable(); },
    onDidCloseTextDocument: (listener: typeof closed) => { closed = listener; return disposable(); },
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
  changed!({ document } as VSCode.TextDocumentChangeEvent);
  expect(cssDiagnostics.get(document.uri.toString())).toEqual([]);
  closed!(document);
  expect(cssDiagnostics.has(document.uri.toString())).toBe(false);
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
  workspaceDirectories = [resolve(import.meta.dirname, '../../jsx-plus/examples/task-board')];
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
