import * as vscode from 'vscode';
import { reactivityHints, type ReactivityHint } from '@memoized-dom/jsx-plus/editor/hints';

/** `auwla.inlayHints.reactivity`: shows what each binding is beside its declaration. */
const SECTION = 'auwla';
const SETTING = 'inlayHints.reactivity';

/**
 * Reactivity inlay hints for `.auwla` files: `state`, `derived ← count`, `source`, faint beside
 * each declaration, like inferred types. The shared core (`@memoized-dom/jsx-plus/editor/hints`)
 * decides them; this only shows them. Like the CSS providers, it does not depend on the
 * TypeScript extension, so hints work even where content mappers are unavailable.
 */
export function registerReactivityHints(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const changed = new vscode.EventEmitter<void>();
  // One analysis per document version: an editor asks again for each visible range.
  const results = new Map<string, { version: number; hints: readonly ReactivityHint[] }>();

  function hintsFor(document: vscode.TextDocument): readonly ReactivityHint[] {
    const key = document.uri.toString();
    const cached = results.get(key);
    if (cached?.version === document.version) return cached.hints;
    let hints: readonly ReactivityHint[] = [];
    try {
      hints = reactivityHints(document.getText(), `./${document.uri.path.split('/').pop() ?? 'App.auwla'}`);
    } catch (error) {
      // A file that does not compile gives no hints and no error; anything else is a bug to see.
      output.appendLine(`Reactivity hints failed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
    results.set(key, { version: document.version, hints });
    return hints;
  }

  const provider: vscode.InlayHintsProvider = {
    onDidChangeInlayHints: changed.event,
    provideInlayHints(document, range) {
      if (!vscode.workspace.getConfiguration(SECTION, document).get<boolean>(SETTING, true)) return [];
      const start = document.offsetAt(range.start);
      const end = document.offsetAt(range.end);
      return hintsFor(document)
        .filter((hint) => start <= hint.offset && hint.offset <= end)
        .map((hint) => {
          const shown = new vscode.InlayHint(document.positionAt(hint.offset), hint.label);
          shown.tooltip = new vscode.MarkdownString(hint.tooltip);
          shown.paddingLeft = true;
          return shown;
        });
    },
  };

  context.subscriptions.push(
    changed,
    { dispose: () => results.clear() },
    vscode.languages.registerInlayHintsProvider({ language: 'auwla' }, provider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.${SETTING}`)) changed.fire();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => results.delete(document.uri.toString())),
  );
}
