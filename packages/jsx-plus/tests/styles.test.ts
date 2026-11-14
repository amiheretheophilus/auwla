import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModulesDetailed, createProject, fileSystemHost } from '@memoized-dom/compiler-next';
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { auwla, normalize } from '../src';
import { projectForChecking } from '../src/checking/project';
import { authoredOffset } from '../src/source';
import { createCssSession } from '../src/styles/tooling';
import cases from '../../../wiki2/spec/styles.cases.json';

const root = fileURLToPath(new URL('./fixtures/apps/styling/', import.meta.url));
const source = readFileSync(`${root}/App.auwla`, 'utf8');

const applications: runtime.MountedApplication[] = [];
afterEach(() => {
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  runtime.resetScheduler();
  document.body.replaceChildren();
});

for (const fixture of cases.cases) {
  it(`${fixture.id}: native CSS profile conformance`, () => {
    if (fixture.error !== undefined) {
      let problem;
      try {
        normalize(fixture.source);
      } catch (error) {
        problem = error;
      }
      expect(problem).toMatchObject(fixture.error);
      return;
    }
    expect(normalize(fixture.source).stylesheet ?? null).toBe(fixture.stylesheet!);
  });
}

it('extracts native CSS in source order and retains exact host mappings', () => {
  const result = normalize(source);
  expect(result.stylesheet).toContain('@media (min-width: 48rem)');
  expect(result.stylesheet!.indexOf(':root')).toBeLessThan(result.stylesheet!.indexOf('.css-demo p'));
  expect(result.code).not.toContain('<style');
  expect(result.code).toContain('<main class={(loading ?');
  const offset = result.code.indexOf('loading = false');
  expect(authoredOffset(result.mappings, offset)).toBe(source.indexOf('loading = false'));
  const checking = projectForChecking(source, './App.auwla');
  expect(checking.diagnostics ?? []).toEqual([]);
  expect(checking.text).not.toContain('border-color');
});

it('respects CSS string/comment delimiters and ignores host strings and nested DOM style tags', () => {
  const text = `const literal = '<style global>not CSS</style>';
<style global> /* </style> */ .a::after { content: "</style>"; } </style>
const css = "body { color: red; }";
export function App() { return <style>css</style>; }`;
  const result = normalize(text);
  expect(result.stylesheet).toBe(' /* </style> */ .a::after { content: "</style>"; } ');
  expect(result.code).toContain("const literal = '<style global>not CSS</style>'");
  expect(result.code).toContain('<style>{css}</style>');
});

it('reports unsupported attributes and missing closing tags at authored positions', () => {
  expect(() => normalize('\n<style scoped>.a { color: red; }</style>')).toThrow('CSS1001');
  expect(() => normalize('\n<style global>.a { color: red; }')).toThrow('CSS1002');
  expect(() => normalize('<style global scoped>.a {}</style>')).toThrow('CSS1001');
});

it('finds trailing styles after real extended templates, and keeps CSS assistance before incomplete markup', () => {
  for (const name of ['task-board/App.auwla', 'team/pages/People.auwla']) {
    const authored = readFileSync(new URL(`./fixtures/apps/${name}`, import.meta.url), 'utf8');
    const text = `${authored}\n<style global>.probe { color: red; }</style>`;
    expect(normalize(text).stylesheet).toBe('.probe { color: red; }');
    const offset = text.indexOf('color: red') + 3;
    expect(createCssSession(text, 'file:///App.auwla')!.complete(offset)!.items.length).toBeGreaterThan(0);
  }
  const incomplete = '<style global>.card { padding: 4px; }</style>\nexport function App() { return <div class=';
  expect(createCssSession(incomplete, 'file:///App.auwla')!.hover(incomplete.indexOf('padding'))).toBeTruthy();
});

it('makes separate CSS assets through the compiler language hook', async () => {
  const build = await createProject({ entries: ['./main.ts'], host: fileSystemHost(root), languages: [auwla] }).build();
  expect(build.ok).toBe(true);
  if (!build.ok) throw build.error;
  expect(build.css?.['./App.auwla.css']).toBe(normalize(source).stylesheet!);
  expect(build.output['./App.auwla']).toContain('./App.auwla.css');
  expect(build.stylesheets).toEqual(['./App.auwla.css']);
  expect(build.output['./App.auwla']).not.toContain('border-color');
  const detailed = compileModulesDetailed({ './App.auwla': source }, { languages: [auwla] });
  expect(detailed.css).toEqual(build.css!);
});

it('bundles the real example into JavaScript and native CSS with the compiler Bun plugin', async () => {
  const result = await Bun.build({
    entrypoints: [`${root}/main.ts`],
    target: 'browser',
    external: ['@memoized-dom/*'],
    plugins: [memoizedDom({ client: './main.ts', root, languages: [auwla] })],
  });
  expect(result.success).toBe(true);
  const css = result.outputs.find((output) => output.path.endsWith('.css'));
  expect(css).toBeDefined();
  expect(await css!.text()).toContain('.css-demo.loading');
  const javascript = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
  expect(javascript).not.toContain('createElement("style")');
  expect(javascript).not.toContain('min-width');
});

for (const optimize of [true, false]) {
  it(`mounts the actual styling entry and toggles its ordinary class, optimize=${optimize}`, async () => {
    const result = await Bun.build({
      entrypoints: [`${root}/main.ts`],
      target: 'browser',
      external: ['@memoized-dom/*'],
      plugins: [memoizedDom({ client: './main.ts', root, languages: [auwla], optimize })],
    });
    expect(result.success).toBe(true);
    const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
    const module = toModuleFunction(code);
    const imports = module.specifiers.map((specifier) => {
      expect(specifier).toBe('@memoized-dom/runtime');
      return runtime;
    });
    const container = document.createElement('div');
    container.id = 'app';
    document.body.append(container);
    runtime.setScheduler((run) => run());
    const exports: Record<string, unknown> = {};
    new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
      imports, exports, () => {}, ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
    );
    applications.push(exports.application as runtime.MountedApplication);

    const main = container.querySelector('main')!;
    const button = main.querySelector('button')!;
    expect(main.classList.contains('loading')).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(main.classList.contains('loading')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toBe('Clear loading class');
    button.click();
    expect(main.classList.contains('loading')).toBe(false);
    expect(button.textContent).toBe('Add loading class');
    expect(document.querySelector('style')).toBeNull();
  });
}

it('offers CSS completion, hover and diagnostics at authored UTF-16 positions', () => {
  const text = 'const emoji = "😀";\r\n<style global>\r\n.card { padd }\r\n</style>\r\nconst outside = 1;';
  const session = createCssSession(text, 'file:///App.auwla')!;
  const cursor = text.indexOf('padd') + 4;
  const padding = session.complete(cursor)!.items.find((item) => item.label === 'padding')!;
  expect(padding).toBeDefined();
  expect(padding.textEdit).toMatchObject({ range: { start: { line: 2, character: 8 } } });
  expect(session.complete(text.indexOf('outside'))).toBeUndefined();

  const valid = createCssSession('<style global>\n.card { padding: 4px; }\n</style>', 'file:///App.auwla')!;
  expect(valid.hover(23)).toBeTruthy();
  expect(valid.diagnostics()).toEqual([]);
  const invalid = createCssSession('<style global>\n.card { unknown-property: red; }\n</style>', 'file:///App.auwla')!;
  expect(invalid.diagnostics()).toContainEqual(expect.objectContaining({
    code: 'unknownProperties', range: expect.objectContaining({ start: { line: 1, character: 8 } }),
  }));
  expect(createCssSession('<style global>\n.card { padd', 'file:///App.auwla')!.complete(27)!.items.length).toBeGreaterThan(0);
});

it('keeps missing-brace diagnostics at the CSS boundary and completion edits inside the body', () => {
  const text = '<style global>\n.card { padding: 4px;\n</style>\nconst unrelated = 1;';
  const session = createCssSession(text, 'file:///App.auwla')!;
  expect(session.diagnostics()).toContainEqual(expect.objectContaining({
    code: 'css-rcurlyexpected',
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
  }));
  const completion = session.complete(text.indexOf('padding') + 4)!;
  expect(completion.items.length).toBeGreaterThan(0);
  for (const item of completion.items) {
    const edit = item.textEdit;
    if (edit === undefined) continue;
    const range = 'range' in edit ? edit.range : edit.replace;
    expect(range.start.line).toBe(1);
    expect(range.end.line).toBe(1);
  }
});

for (const newline of ['\n', '\r\n']) {
  it(`keeps an unfinished CSS declaration scoped to its property with ${JSON.stringify(newline)}`, () => {
    const text = [
      'const emoji = "😀";',
      '<style global>',
      '.css-demo button {',
      '  padding: 8px 16px;',
      '  font: inherit;',
      '  cur',
      '}',
      '.css-demo button:hover {',
      '  outline: 2px solid #2563eb;',
      '}',
      '</style>',
    ].join(newline);
    const session = createCssSession(text, 'file:///App.auwla')!;
    expect(session.diagnostics()).toEqual([expect.objectContaining({
      code: 'css-colonexpected',
      range: { start: { line: 5, character: 2 }, end: { line: 5, character: 5 } },
    })]);

    const cursor = session.complete(text.indexOf('  cur') + 5)!.items.find((item) => item.label === 'cursor')!;
    expect(cursor.textEdit).toMatchObject({
      range: { start: { line: 5, character: 2 }, end: { line: 5, character: 5 } },
    });
    // Apply the native snippet's final tab stop, then recheck the authored text.
    const value = cursor.textEdit!.newText.replace('$0', 'pointer');
    const corrected = text.replace('  cur' + newline, '  ' + value + newline);
    expect(createCssSession(corrected, 'file:///App.auwla')!.diagnostics()).toEqual([]);
    expect(session.hover(text.indexOf('outline:'))).toBeTruthy();
  });
}

it('recovers multiple unfinished declarations while retaining independent CSS errors and warnings', () => {
  const text = '<style global>\n.a { cur }\n.b { col /* comment with } : */ }\n.empty {}\n.bad { unknown-property: red; }\n</style>';
  const session = createCssSession(text, 'file:///App.auwla')!;
  expect(session.diagnostics().map((diagnostic) => [diagnostic.code, diagnostic.range.start])).toEqual([
    ['css-colonexpected', { line: 1, character: 5 }],
    ['css-colonexpected', { line: 2, character: 5 }],
    ['emptyRules', { line: 3, character: 0 }],
    ['unknownProperties', { line: 4, character: 7 }],
  ]);
  expect(session.complete(text.indexOf(' col') + 4)!.items.some((item) => item.label === 'color')).toBe(true);
  expect(normalize(text).stylesheet).toContain('.a { cur }');
});

it('retains native CSS strings, escapes, custom-property blocks and nesting during recovery', () => {
  const text = String.raw`<style global>
.card {
  content: "cur } : ;";
  --tokens: { cur };
  & > button { c\75r }
}
@media (min-width: 48rem) {
  .next { outline: 2px solid blue; }
}
</style>`;
  const session = createCssSession(text, 'file:///App.auwla')!;
  expect(session.diagnostics()).toEqual([expect.objectContaining({
    code: 'css-colonexpected',
    range: { start: { line: 4, character: 15 }, end: { line: 4, character: 20 } },
  })]);
  expect(session.hover(text.indexOf('outline:'))).toBeTruthy();
});
