import * as vscode from 'vscode';
import { reactivityHints, type ReactivityHint } from '@memoized-dom/jsx-plus/editor/hints';

/** `auwla.reactivityHints`: shows what each binding is beside its declaration. */
const SECTION = 'auwla';
const SETTING = 'reactivityHints';
/** Theme colors this extension contributes (`package.json`), so a theme or user can restyle them. */
const FOREGROUND = 'auwla.reactivityHint.foreground';
const BACKGROUND = 'auwla.reactivityHint.background';
/** Wait for typing to pause before analyzing again. */
const DELAY = 150;

/**
 * Reactivity hints for `.auwla` files: `: state`, `: derived ← count`, `: source` beside each
 * declaration, like an inferred type. The shared core (`@memoized-dom/jsx-plus/editor/hints`)
 * decides them; this only shows them.
 *
 * They are decorations, not inlay hints: VS Code draws every inlay hint in the theme's one
 * inlay-hint color, which reads like a comment, while a decoration takes this extension's own
 * colors. Hovering the declared name explains the hint. Like the CSS providers, this does not
 * depend on the TypeScript extension.
 */
export function registerReactivityHints(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const style = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor(FOREGROUND),
      backgroundColor: new vscode.ThemeColor(BACKGROUND),
      margin: '0 0 0 0.1em',
    },
  });
  // One analysis per document version: several editors can show one document.
  const results = new Map<string, { version: number; hints: readonly ReactivityHint[] }>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

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

  function paint(editor: vscode.TextEditor): void {
    const { document } = editor;
    if (document.languageId !== 'auwla') return;
    const enabled = vscode.workspace.getConfiguration(SECTION, document).get<boolean>(SETTING, true);
    editor.setDecorations(style, enabled ? hintDecorations(document, hintsFor(document)) : []);
  }

  function paintAll(): void {
    for (const editor of vscode.window.visibleTextEditors) paint(editor);
  }

  function repaintLater(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(pending.get(key));
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) paint(editor);
      }
    }, DELAY));
  }

  context.subscriptions.push(
    style,
    {
      dispose() {
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
        results.clear();
      },
    },
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(paint)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'auwla') repaintLater(event.document);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.${SETTING}`)) paintAll();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => results.delete(document.uri.toString())),
  );
  paintAll();
}

/** Each hint as a decoration: `: label` after the declaration, explained when it is hovered. */
export function hintDecorations(document: vscode.TextDocument, hints: readonly ReactivityHint[]): vscode.DecorationOptions[] {
  return hints.map((hint) => {
    const start = document.positionAt(hint.start);
    const end = document.positionAt(hint.offset);
    return {
      range: new vscode.Range(start.line, start.character, end.line, end.character),
      hoverMessage: new vscode.MarkdownString(hint.tooltip),
      renderOptions: { after: { contentText: `: ${hint.label}` } },
    };
  });
}
