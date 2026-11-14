// Runs the built artifact in Node, outside the workspace, with only the VS Code API supplied.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { readFileSync } = require('node:fs');

let completionProvider;
let hoverProvider;
let showEditors;
let painted = [];
let problems = [];
let source = process.argv[3] === undefined
  ? '<style global>\n.card { padding: 4px; unknown-property: red; cur }\n.card:hover { outline: 2px solid blue; }\n.card { color:black @.loading:re; }\n</style>'
  : readFileSync(process.argv[3], 'utf8');
const document = {
  uri: { toString: () => 'file:///example.auwla', path: '/example.auwla' },
  version: 1,
  languageId: 'auwla',
  getText: () => source,
  offsetAt(position) {
    return source.split('\n').slice(0, position.line)
      .reduce((length, line) => length + line.length + 1, 0) + position.character;
  },
  positionAt(offset) {
    const lines = source.slice(0, offset).split('\n');
    return { line: lines.length - 1, character: lines.at(-1).length };
  },
};
const disposable = () => ({ dispose() {} });
const vscode = {
  Range: class {
    constructor(line, character, endLine, endCharacter) {
      this.start = { line, character };
      this.end = { line: endLine, character: endCharacter };
    }
  },
  Diagnostic: class {
    constructor(range, message, severity) { Object.assign(this, { range, message, severity }); }
  },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  CompletionItem: class {
    constructor(label, kind) { Object.assign(this, { label, kind }); }
  },
  CompletionList: class {
    constructor(items, isIncomplete) { Object.assign(this, { items, isIncomplete }); }
  },
  MarkdownString: class {
    constructor(value = '') { this.value = value; }
    appendCodeblock(value) { this.value += value; return this; }
  },
  SnippetString: class { constructor(value) { this.value = value; } },
  TextEdit: class { constructor(range, newText) { Object.assign(this, { range, newText }); } },
  Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  languages: {
    createDiagnosticCollection: () => ({
      set: (_uri, entries) => { problems = entries; },
      delete() {}, dispose() {},
    }),
    registerCompletionItemProvider(_selector, provider) { completionProvider = provider; return disposable(); },
    registerHoverProvider(_selector, provider) { hoverProvider = provider; return disposable(); },
  },
  workspace: {
    workspaceFolders: [],
    textDocuments: [document],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidChangeConfiguration: disposable,
    onDidOpenTextDocument: disposable,
    onDidChangeTextDocument: disposable,
    onDidCloseTextDocument: disposable,
  },
  window: {
    createTextEditorDecorationType: () => ({ dispose() {} }),
    visibleTextEditors: [],
    onDidChangeVisibleTextEditors(listener) { showEditors = listener; return disposable(); },
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    showWarningMessage: async () => undefined,
  },
  extensions: { getExtension: () => undefined },
};

const load = Module._load;
Module._load = function(id, ...args) {
  if (id === 'vscode') {
    return vscode;
  }
  return load.call(this, id, ...args);
};

async function run() {
  const entry = process.argv[2];
  const context = { subscriptions: [], extensionPath: path.dirname(entry) };
  await require(entry).activate(context);
  if (process.argv[3] !== undefined) {
    assert.deepEqual(problems, [], 'the real class-condition example must have no CSS diagnostics');
    const marker = '@.loading:';
    const offset = source.indexOf(marker) + marker.length;
    assert.ok(offset >= marker.length);
    // Native CSS completion does not offer keywords inside an existing hex
    // token. Reproduce authoring a named value in the unsaved document instead.
    const hex = /^#[\da-f]+/i.exec(source.slice(offset));
    assert.ok(hex);
    source = source.slice(0, offset) + 're' + source.slice(offset + hex[0].length);
    document.version++;
    const lines = source.slice(0, offset + 2).split('\n');
    const position = { line: lines.length - 1, character: lines.at(-1).length };
    const completion = await completionProvider.provideCompletionItems(document, position);
    assert.ok(completion.items.some((item) => item.label === 'red'));
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
    console.log('Real example: zero CSS diagnostics and conditional value completion passed');
    return;
  }
  const position = { line: 1, character: 12 };
  const completion = await completionProvider.provideCompletionItems(document, position);
  const padding = completion.items.find((item) => item.label === 'padding');
  assert.ok(padding, 'the installed artifact must offer padding completion');
  assert.deepEqual(padding.range.start, { line: 1, character: 8 });
  assert.ok((await hoverProvider.provideHover(document, position)).contents.length);
  assert.ok(problems.some((problem) => problem.code === 'unknownProperties'));
  const incomplete = problems.filter((problem) => problem.code === 'css-colonexpected');
  assert.equal(incomplete.length, 1);
  assert.deepEqual(incomplete[0].range.start, { line: 1, character: 45 });
  assert.ok(problems.every((problem) => problem.range.start.line === 1));
  const conditional = await completionProvider.provideCompletionItems(document, { line: 3, character: 32 });
  const red = conditional.items.find((item) => item.label === 'red');
  assert.ok(red, 'the installed artifact must complete native values inside a class condition');
  assert.deepEqual(red.range.start, { line: 3, character: 30 });

  // Reactivity hints run compiler-next's analysis from inside the bundle.
  source = 'export function Counter() {\n  let count = 0;\n  const doubled = count * 2;\n  return <button onClick={() => count++}>doubled</button>;\n}\n';
  document.version++;
  showEditors([{ document, setDecorations(_style, options) { painted = options; } }]);
  assert.deepEqual(painted.map((decoration) => [decoration.range.end, decoration.renderOptions.after.contentText]), [
    [{ line: 1, character: 11 }, ': state'],
    [{ line: 2, character: 15 }, ': derived ← count'],
  ]);
  for (const subscription of context.subscriptions) {
    subscription.dispose();
  }
  console.log('CSS bundle: completion, hover and diagnostics passed in Node');
  console.log('Reactivity hints passed in Node');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
