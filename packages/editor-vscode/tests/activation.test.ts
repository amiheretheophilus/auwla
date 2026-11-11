import { beforeEach, expect, it, mock } from 'bun:test';
import { resolve } from 'node:path';
import type { ExtensionContext } from 'vscode';
import type { ContentMapperContribution, TypeScriptSDK } from 'typescript/vscode';
import { auwlaLanguage } from '@memoized-dom/jsx-plus/editor';
import manifest from '../package.json';

const messages: string[] = [];
const lines: string[] = [];
const commands: string[] = [];
let chosenAction: string | undefined;
let workspaceDirectories: string[] = [];
let provider: { activate(): Promise<unknown> } | undefined;
mock.module('vscode', () => ({
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
  expect(session.subscriptions).toHaveLength(1);
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
