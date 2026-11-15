import * as vscode from 'vscode';
import type { CssDirectoryEntry, CssSourceHost } from '@memoized-dom/jsx-plus/styles/sources';

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'FileNotFound' || error.code === 'FileNotADirectory');
}

/** SDK boundary only: parsing, completion and dependency rules stay shared. */
export function createEditorCssSourceHost(reading: (uri: string) => void): CssSourceHost | undefined {
  if (typeof vscode.workspace.fs?.readFile !== 'function' || typeof vscode.Uri?.parse !== 'function') {
    return undefined;
  }
  return {
    async readFile(uri) {
      reading(uri);
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri);
      if (open !== undefined) {
        return open.getText();
      }
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
      } catch (error) {
        if (missing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async readDirectory(uri) {
      reading(uri);
      let entries: readonly [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(vscode.Uri.parse(uri));
      } catch (error) {
        if (missing(error)) {
          return [];
        }
        throw error;
      }
      return entries.flatMap(([name, kind]): CssDirectoryEntry[] => {
        if ((kind & vscode.FileType.Directory) !== 0) {
          return [{ name, kind: 'directory' }];
        }
        return (kind & vscode.FileType.File) !== 0 ? [{ name, kind: 'file' }] : [];
      });
    },
  };
}
