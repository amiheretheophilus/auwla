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
