import * as vscode from 'vscode';
import type { ExtensionAPI } from 'typescript/vscode';
import { createMapperContribution } from '@memoized-dom/jsx-plus/editor';
import { findMapperPackage } from './mapper-package';

/** The provider matching the pinned TypeScript 7.1-beta extension API. */
const TYPESCRIPT_EXTENSION = 'TypeScriptTeam.native-preview';

function hasMapperRegistration(value: unknown): value is Pick<ExtensionAPI, 'registerContentMappers'> {
  return typeof value === 'object' && value !== null
    && 'registerContentMappers' in value && typeof value.registerContentMappers === 'function';
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Auwla');
  context.subscriptions.push(output);

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
    output.appendLine('Registered .auwla with the TypeScript content-mapper host.');
  } catch (error) {
    unavailable(`Auwla could not register its TypeScript mapper: ${error instanceof Error ? error.message : String(error)}`);
  }
}
