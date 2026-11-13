import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { INITIAL, Registry, parseRawGrammar, type IToken } from 'vscode-textmate';
import { auwlaLanguage, createMapperContribution } from '../src/editor/registration';
import { createAuwlaGrammar } from '../src/editor/grammar';
import { rpcProcess } from './rpc';

const packageRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
const registry = new Registry({
  onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
  async loadGrammar(scopeName) {
    if (scopeName === 'source.css') {
      const filename = resolve(packageRoot, 'editor-assets/vendor/css.tmLanguage.json');
      return parseRawGrammar(readFileSync(filename, 'utf8'), filename);
    }
    if (scopeName !== auwlaLanguage.scopeName) {
      return null;
    }
    const filename = resolve(packageRoot, 'editor-assets/vendor/TypeScriptReact.tmLanguage');
    return createAuwlaGrammar(parseRawGrammar(readFileSync(filename, 'utf8'), filename));
  },
});
const grammar = (await registry.loadGrammar(auwlaLanguage.scopeName))!;

function tokenize(source: string) {
  let state = INITIAL;
  let offset = 0;
  const tokens: (IToken & { text: string })[] = [];
  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, state);
    for (const token of result.tokens) {
      tokens.push({
        ...token,
        startIndex: offset + token.startIndex,
        endIndex: offset + token.endIndex,
        text: line.slice(token.startIndex, token.endIndex),
      });
    }
    state = result.ruleStack;
    offset += line.length + 1;
  }
  return tokens;
}

it('embeds native CSS highlighting and resumes TypeScript after the closing block', () => {
  const source = '<style global>\n.card { padding: 4px; content: "</style>"; }\n/* </style> */\n</style>\nexport const title = "ready";';
  const tokens = tokenize(source);
  function scopesAt(text: string) {
    const offset = source.indexOf(text);
    return tokens.find((token) => token.startIndex <= offset && offset < token.endIndex)!.scopes;
  }
  expect(scopesAt('padding')).toContain('meta.embedded.block.css');
  expect(scopesAt('padding').some((scope) => scope.startsWith('support.type.property-name'))).toBe(true);
  expect(scopesAt('4px').some((scope) => scope.startsWith('constant.numeric'))).toBe(true);
  expect(scopesAt('title')).not.toContain('meta.embedded.block.css');
  expect(scopesAt('title')).toContain('variable.other.constant.tsx');
});

it('highlights compact class-condition headers while preserving literal CSS strings', () => {
  const source = '<style global>\n.a { color:black @.loading:red; content:"@.literal:x"; width:var(--x, @.inside:y); height:future(@.nested:y); }\n</style>';
  const tokens = tokenize(source);
  const scopesAt = (text: string) => {
    const offset = source.indexOf(text);
    return tokens.find((token) => token.startIndex <= offset && offset < token.endIndex)!.scopes;
  };
  expect(scopesAt('loading')).toContain('meta.auwla.css-condition');
  expect(scopesAt('loading')).toContain('entity.other.attribute-name.class.css');
  expect(scopesAt('literal')).not.toContain('meta.auwla.css-condition');
  expect(scopesAt('inside')).not.toContain('meta.auwla.css-condition');
  expect(scopesAt('nested')).not.toContain('meta.auwla.css-condition');
});

it('highlights the real task board with the shared TSX-derived grammar', () => {
  const source = readFileSync(resolve(packageRoot, 'examples/task-board/App.auwla'), 'utf8');
  const tokens = tokenize(source);
  function scopesAt(text: string, within = 0) {
    const offset = source.indexOf(text) + within;
    expect(offset).toBeGreaterThanOrEqual(within);
    return tokens.find((token) => token.startIndex <= offset && offset < token.endIndex)!.scopes;
  }

  expect(scopesAt('"Make room', 1).some((scope) => scope.startsWith('string.quoted.'))).toBe(true);
  expect(scopesAt('for (const task').some((scope) => scope.startsWith('keyword.control.'))).toBe(true);
  expect(scopesAt('onClick=focusTaskInput', 'onClick='.length)).toContain('variable.other.readwrite.tsx');
  expect(scopesAt('aria-label=("Remove "', 'aria-label=('.length)).toContain('string.quoted.double.tsx');
  expect(scopesAt('onClick=focusTaskInput', 'onClick='.length).some((scope) => scope.startsWith('invalid.'))).toBe(false);
  expect(tokens.some((token) => token.scopes.some((scope) => scope.startsWith('string.template.')))).toBe(true);
  expect(tokens.filter((token) => token.scopes.some((scope) => scope.startsWith('invalid.')))
    .map((token) => token.text)).toEqual([]);
  expect(tokens.at(-1)!.scopes).toEqual([auwlaLanguage.scopeName]);
});

it('keeps quoted delimiters, nested parentheses and template interpolation in their lexical contexts', () => {
  const source = '<p title=(format((value)))>"</p> is text"; `Hi ${user.name}`</p>';
  const tokens = tokenize(source);
  const quotedTag = source.indexOf('</p>');
  const name = source.indexOf('user.name');
  expect(tokens.find((token) => token.startIndex <= quotedTag && quotedTag < token.endIndex)!.scopes)
    .toContain('string.quoted.double.tsx');
  expect(tokens.find((token) => token.startIndex <= name && name < token.endIndex)!.scopes
    .some((scope) => scope.startsWith('meta.template.expression.'))).toBe(true);
  expect(tokens.at(-1)!.scopes.some((scope) => scope.startsWith('string.'))).toBe(false);
  expect(tokens.some((token) => token.scopes.some((scope) => scope.startsWith('invalid.')))).toBe(false);
});

it('highlights quoted substitutions in direct child blocks while keeping ordinary call strings static', () => {
  const source = '<p>if (ready) { "Count {count}" } else { for (const item of items) { "{item.name}" } } format("{literal}")</p>';
  const tokens = tokenize(source);
  function scopesAt(text: string) {
    const offset = source.indexOf(text);
    return tokens.find((token) => token.startIndex <= offset && offset < token.endIndex)!.scopes;
  }
  expect(scopesAt('count}')).toContain('meta.embedded.expression.auwla');
  expect(scopesAt('item.name}')).toContain('meta.embedded.expression.auwla');
  expect(scopesAt('literal}')).not.toContain('meta.embedded.expression.auwla');
  expect(tokens.at(-1)!.scopes.some((scope) => scope.startsWith('string.'))).toBe(false);
});

it('classifies an interpolated identifier as code so string completion settings do not suppress it', () => {
  function attributesAt(source: string, text: string): number {
    const offset = source.indexOf(text);
    const tokens = grammar.tokenizeLine2(source, INITIAL).tokens;
    for (let index = 0; index < tokens.length; index += 2) {
      const end = tokens[index + 2] ?? source.length;
      if (tokens[index]! <= offset && offset < end) {
        return tokens[index + 1]!;
      }
    }
    throw new Error('Token not found');
  }
  const code = attributesAt('let count = 0;', 'count');
  expect(attributesAt('<p>"Count {count}"</p>', 'count}')).toBe(code);
  expect(attributesAt('<p>"Count {count}"</p>', 'Count')).not.toBe(code);
});

it('launches the shared mapper from its editor contribution without any editor SDK', async () => {
  const contribution = createMapperContribution(packageRoot);
  const manifest = contribution.inferredProjectContribution.manifest;
  const [command, ...args] = manifest.exec;
  const mapper = rpcProcess(command!, args, manifest.cwd.fsPath);
  try {
    expect(contribution.extensions).toEqual(['.auwla']);
    await mapper.connection.sendRequest('initialize', { positionEncodings: ['utf-16'] });
    await mapper.connection.sendRequest('openProject', { projectHandle: 'editor' });
    const source = readFileSync(resolve(packageRoot, 'examples/task-board/App.auwla'), 'utf8');
    const result = await mapper.connection.sendRequest<{ text: string }>('transform', {
      projectHandle: 'editor',
      fileName: resolve(packageRoot, 'examples/task-board/App.auwla'), content: source,
    });
    expect(result.text).toContain('function removeTask');
    expect(result.text).toContain('Array.from(visible');
    await mapper.connection.sendRequest('closeProject', { projectHandle: 'editor' });
  } finally {
    await mapper.close();
  }
});
