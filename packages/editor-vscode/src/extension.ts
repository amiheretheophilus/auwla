import * as vscode from 'vscode';
import type { ExtensionAPI } from 'typescript/vscode';
import { createMapperContribution } from '@memoized-dom/jsx-plus/editor';
import { findMapperPackage } from './mapper-package';
import { registerCss } from './css';

/** The provider matching the pinned TypeScript 7.1-beta extension API. */
const TYPESCRIPT_EXTENSION = 'TypeScriptTeam.native-preview';

type MapperHost = Pick<ExtensionAPI, 'registerContentMappers'>
  & Partial<Pick<ExtensionAPI, 'onLanguageServerInitialized'>>;

function hasMapperRegistration(value: unknown): value is MapperHost {
  return typeof value === 'object' && value !== null
    && 'registerContentMappers' in value && typeof value.registerContentMappers === 'function';
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Auwla');
  context.subscriptions.push(output);
  registerCss(context);

  function unavailable(message: string) {
    output.appendLine(message);
    void vscode.window.showWarningMessage(message);
  }

  const provider = vscode.extensions.getExtension<unknown>(TYPESCRIPT_EXTENSION);
  if (provider === undefined) {
    unavailable('Auwla language features need the TypeScript 7 extension (TypeScriptTeam.native-preview). Syntax highlighting is still available.');
    return;
  }

  try {
    const api = await provider.activate();
    if (!hasMapperRegistration(api)) {
      unavailable('The installed TypeScript extension does not expose content-mapper registration. Use a compatible TypeScript 7 version.');
      return;
    }

    // An installed extension lives outside the project. Resolve the shared
    // package from workspace folders before trying the development-host path.
    const workspaceDirectories = (vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.uri.scheme === 'file')
      .map((folder) => folder.uri.fsPath);
    const packageDirectory = findMapperPackage(workspaceDirectories, context.extensionPath);
    const contribution = createMapperContribution(packageDirectory);
    const registration = api.registerContentMappers(context.extension.id, [contribution]);
    context.subscriptions.push(registration);
    output.appendLine('Registered the .auwla content-mapper contribution.');

    // The extension can expose the registration API while running an older
    // server that rejects the protocol request. Report the actual selected SDK,
    // not just the presence of the JavaScript API, so this cannot fail silently.
    if (typeof api.onLanguageServerInitialized === 'function') {
      let warnedVersion: string | undefined;
      const listener = api.onLanguageServerInitialized((sdk) => {
        output.appendLine(`TypeScript language server SDK: ${sdk.version}`);
        const version = /^(\d+)\.(\d+)/.exec(sdk.version);
        if (version === null) {
          return;
        }
        const major = Number(version[1]);
        const minor = Number(version[2]);
        const tooOld = major < 7 || (major === 7 && minor < 1);
        if (!tooOld || warnedVersion === sdk.version) {
          return;
        }
        warnedVersion = sdk.version;
        const action = 'Select Workspace SDK';
        void vscode.window.showWarningMessage(
          `Auwla needs TypeScript 7.1 or later for content mappers. The selected server is ${sdk.version}. Choose the workspace TypeScript 7.1.0-beta SDK.`,
          action,
        ).then((selected) => {
          if (selected === action) {
            return vscode.commands.executeCommand('typescript.native-preview.selectVersion');
          }
          return undefined;
        });
      });
      context.subscriptions.push(listener);
    }
  } catch (error) {
    unavailable(`Auwla could not register its TypeScript mapper: ${error instanceof Error ? error.message : String(error)}`);
  }
}
