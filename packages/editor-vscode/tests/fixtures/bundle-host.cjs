// Runs the built artifact in Node, outside the workspace, with only the VS Code API supplied.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

let completionProvider;
let hoverProvider;
let problems = [];
const source = '<style global>\n.card { padding: 4px; unknown-property: red; cur }\n.card:hover { outline: 2px solid blue; }\n</style>';
const document = {
  uri: { toString: () => 'file:///example.auwla' },
  version: 1,
  languageId: 'auwla',
  getText: () => source,
  offsetAt(position) {
    return source.split('\n').slice(0, position.line)
      .reduce((length, line) => length + line.length + 1, 0) + position.character;
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
    onDidOpenTextDocument: disposable,
    onDidChangeTextDocument: disposable,
    onDidCloseTextDocument: disposable,
  },
  window: {
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
  for (const subscription of context.subscriptions) {
    subscription.dispose();
  }
  console.log('CSS bundle: completion, hover and diagnostics passed in Node');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
