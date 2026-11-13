import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, parse } from 'css-tree';
import { compileModulesDetailed } from '@memoized-dom/compiler-next';
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { auwla, normalize } from '../src';
import { createCssSession } from '../src/styles/tooling';
import fixtures from '../../../wiki2/spec/style-conditions.cases.json';

const canonical = (source: string) => generate(parse(source));
for (const fixture of fixtures.cases) {
  it(`${fixture.id}: compact class-condition conformance`, () => {
    const source = `<style global>${fixture.source}</style>`;
    if (fixture.error !== undefined) {
      expect(() => normalize(source)).toThrow(fixture.error);
    } else {
      expect(canonical(normalize(source).stylesheet!)).toBe(canonical(fixture.css!));
    }
  });
}

it('copies ordinary native CSS exactly, including literal condition-like contents', () => {
  const css = '.a { --tokens:{@.literal:x}; content:"@.literal:y"; background:url(icon@.literal.svg); }';
  expect(normalize(`<style global>${css}</style>`).stylesheet).toBe(css);
});

it('keeps native value edits, hover and CSS diagnostics at authored condition positions', () => {
  const text = 'const emoji = "😀";\r\n<style global>\r\n.card { color:black @.loading:re; }\r\n</style>';
  const session = createCssSession(text, 'file:///App.auwla')!;
  expect(session.diagnostics()).toEqual([]);
  const red = session.complete(text.indexOf(':re') + 3)!.items.find((item) => item.label === 'red')!;
  expect(red.textEdit).toMatchObject({
    range: { start: { line: 2, character: 30 }, end: { line: 2, character: 32 } }, newText: 'red',
  });
  expect(session.hover(text.indexOf('color:'))).toBeTruthy();
  const invalid = text.replace('@.loading:re', '@.loading:');
  expect(createCssSession(invalid, 'file:///App.auwla')!.diagnostics()).toContainEqual(expect.objectContaining({
    code: 'CSS2001', range: { start: { line: 2, character: 20 }, end: { line: 2, character: 30 } },
  }));
});

it('keeps genuine native CSS errors after a conditional declaration', () => {
  const text = '<style global>.a { color:black @.loading:red; } .b { unknown-property: red; }</style>';
  expect(createCssSession(text, 'file:///App.auwla')!.diagnostics()).toEqual([
    expect.objectContaining({ code: 'unknownProperties' }),
  ]);
});

it('preserves comments, repeated conditions, custom properties and escaped selector names', () => {
  const css = String.raw`/* keep this */
@layer base;
.card:\62 efore {
  --space:4px/**/@.café /* header */ :8px @.café:12px;
}`;
  const result = normalize(`<style global>${css}</style>`).stylesheet!;
  expect(result).toContain('/* keep this */');
  expect(result).toContain('@layer base;');
  expect(result).toContain(String.raw`.card.café:\62 efore{--space:8px;}`);
  expect(result.indexOf('--space:8px')).toBeLessThan(result.indexOf('--space:12px'));
  expect(() => normalize(String.raw`<style global>@\6b eyframes fade { from { opacity:1 @.loading:0; } }</style>`))
    .toThrow('outside keyframes');
});

it('keeps one useful error while a condition header is incomplete', () => {
  for (const header of ['@.', '@.loading']) {
    const source = `<style global>.a { color:black ${header}; } .b { color:red; }</style>`;
    const problems = createCssSession(source, 'file:///App.auwla')!.diagnostics();
    expect(problems).toHaveLength(1);
    expect(problems[0]!.code).toBe('CSS2001');
  }
});

it('rejects an unknown priority instead of turning it into !important', () => {
  expect(() => normalize('<style global>.a { padding:4px @.loading:30px !foo; }</style>'))
    .toThrow('Only a final !important');
});

it('keeps current-source CSS checking available through typed condition prefixes', () => {
  const examples = [
    '.card { padding:4px @.loading:30px; color:black; }',
    '@media (min-width:48rem) { .card { color:black @.loading:red; } }',
    '.card { content:"@.literal"; --tokens:{@.literal:x}; padding:4px @.loading:30px; }',
  ];
  for (const css of examples) {
    for (let end = 0; end <= css.length; end++) {
      const source = '<style global>' + css.slice(0, end) + '</style>';
      const session = createCssSession(source, 'file:///App.auwla');
      expect(session).toBeDefined();
      session!.diagnostics();
      session!.complete('<style global>'.length + end);
    }
  }
});

it('reports malformed condition syntax at the original module location', () => {
  const source = 'const emoji = "😀";\r\n<style global>\r\n.a { color:red @.loading:; }\r\n</style>';
  expect(() => compileModulesDetailed({ './Card.auwla': source }, { languages: [auwla] }))
    .toThrow('./Card.auwla:3:16');
});

const root = fileURLToPath(new URL('../examples/class-conditions/', import.meta.url));
const applications: runtime.MountedApplication[] = [];
afterEach(() => {
  for (const app of applications.splice(0)) {
    app.unmount();
  }
  runtime.resetScheduler();
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-class-condition-test]').forEach((node) => node.remove());
});

for (const optimize of [true, false]) {
  it(`runs the real class-condition example and applies its emitted CSS, optimize=${optimize}`, async () => {
    const result = await Bun.build({
      entrypoints: [`${root}/main.ts`], target: 'browser', external: ['@memoized-dom/*'],
      plugins: [memoizedDom({ root, client: './main.ts', languages: [auwla], optimize })],
    });
    expect(result.success).toBe(true);
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))!.text();
    expect(css).not.toContain('@.');
    expect(css).toMatch(/\.card\.error::?before/);
    const style = document.createElement('style');
    style.dataset.classConditionTest = '';
    style.textContent = css;
    document.head.append(style);

    const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
    expect(code).not.toContain('border-color');
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
    const card = container.querySelector('.card')!;
    const [loading, error, expand] = container.querySelectorAll('button');
    expect(getComputedStyle(card).paddingTop).toBe('16px');
    loading!.click();
    expect(card.classList.contains('loading')).toBe(true);
    expect(getComputedStyle(card).borderTopColor).toBe('#d97706');
    error!.click();
    expect(getComputedStyle(card).borderTopColor).toBe('#dc2626');
    expand!.click();
    expect(getComputedStyle(card).paddingTop).toBe('32px');
    error!.click();
    expect(getComputedStyle(card).borderTopColor).toBe('#d97706');
  });
}

it('authors native CSS properties in the example, with no property aliases or breakpoint assumptions', () => {
  const source = readFileSync(`${root}/App.auwla`, 'utf8');
  expect(source).toContain('padding: 16px @.expanded:32px');
  expect(normalize(source).stylesheet).not.toContain('@.');
});
