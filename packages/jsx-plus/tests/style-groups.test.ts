import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from 'css-tree';
import type { Window } from 'happy-dom';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { memoizedDom } from '../../compiler/src/project/bun';
import { toModuleFunction } from '../../compiler/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { auwla, normalize } from '../src';
import { parseStylesheet } from '../src/styles/syntax';
import { createCssSession } from '../src/styles/tooling';
import fixtures from '../../../wiki2/spec/style-groups.cases.json';

function canonical(source: string): string {
  return generate(parseStylesheet(source));
}

for (const fixture of fixtures.cases) {
  it(`${fixture.id}: grouped numeric conformance`, () => {
    const source = `<style global>${fixture.source}</style>`;
    if (fixture.error !== undefined) {
      expect(() => normalize(source)).toThrow(fixture.error);
    } else {
      expect(canonical(normalize(source).stylesheet!)).toBe(canonical(fixture.css!));
    }
  });
}

it('makes grouped bare/explicit pixels equivalent and preserves literal token contexts', () => {
  for (const threshold of ['0', '700', '.5', '1e3']) {
    const bare = normalize(`<style>.a {@${threshold} {padding:24px;}}</style>`);
    const explicit = normalize(`<style>.a {@${threshold}px {padding:24px;}}</style>`);
    expect(bare.stylesheet).toBe(explicit.stylesheet);
  }
  const literal = '.a {content:"@700 {literal}"; --tokens:{@700 {x:y}}; --function:future(@700 {x:y}); background:url(icon@700.svg);}';
  expect(normalize(`<style global>${literal}</style>`).stylesheet).toBe(literal);
  expect(normalize(`<style global>${literal} @700 {.b {color:red;}}</style>`).stylesheet).toContain(literal);
});

it('keeps group property/value completion, hover and independent diagnostics at authored UTF-16 positions', () => {
  const source = 'const emoji = "😀";\r\n<style>\r\n.card {\r\n  @700px {\r\n    color: re;\r\n    padd\r\n  }\r\n}\r\n.bad {unknown-property:red;}\r\n</style>';
  const session = createCssSession(source, 'file:///Card.auwla')!;
  const red = session.complete(source.indexOf(': re') + 4)!.items.find((item) => item.label === 'red')!;
  expect(red.textEdit).toMatchObject({
    range: { start: { line: 4, character: 11 }, end: { line: 4, character: 13 } }, newText: 'red',
  });
  expect(session.complete(source.indexOf('padd') + 4)!.items.some((item) => item.label === 'padding')).toBe(true);
  expect(session.hover(source.indexOf('color:'))).toBeTruthy();
  expect(session.diagnostics()).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'css-colonexpected', range: { start: { line: 5, character: 4 }, end: { line: 5, character: 8 } } }),
    expect.objectContaining({ code: 'unknownProperties', range: expect.objectContaining({ start: { line: 8, character: 6 } }) }),
  ]));
  const invalid = source.replace('@700px', '@-700px');
  expect(createCssSession(invalid, 'file:///Card.auwla')!.diagnostics()).toContainEqual(expect.objectContaining({
    code: 'CSS2001', range: { start: { line: 3, character: 2 }, end: { line: 3, character: 10 } },
  }));
  expect(() => compileModulesDetailed({ './Card.auwla': invalid.replace('    padd\r\n', '') }, { languages: [auwla] }))
    .toThrow('./Card.auwla:4:3');
});

it('retains current-source CSS recovery through every prefix of a grouped fixture', () => {
  const css = '.card {@700px {padding:4px @.expanded:12px; @900 {.title {color:navy;}}} color:black;}';
  for (let end = 0; end <= css.length; end++) {
    const source = `<style>${css.slice(0, end)}</style>`;
    const session = createCssSession(source, 'file:///Card.auwla')!;
    expect(session).toBeDefined();
    session.diagnostics();
    session.complete('<style>'.length + end);
  }
});

it('keeps empty groups valid without hiding unrelated native empty-rule warnings', () => {
  for (const css of ['@700 {}', '.card {@700 {}}']) {
    expect(createCssSession(`<style>${css}</style>`, 'file:///Card.auwla')!.diagnostics()).toEqual([]);
  }
  const source = '<style>@700 {} .ordinary {}</style>';
  expect(createCssSession(source, 'file:///Card.auwla')!.diagnostics()).toEqual([
    expect.objectContaining({ code: 'emptyRules', range: expect.objectContaining({ start: { line: 0, character: 15 } }) }),
  ]);
});

const root = fileURLToPath(new URL('./fixtures/apps/style-groups/', import.meta.url));
const browser = window as unknown as Window;
const initialSize = { width: browser.innerWidth, height: browser.innerHeight };
const applications: runtime.MountedApplication[] = [];

afterEach(() => {
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  runtime.resetScheduler();
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-group-test]').forEach((style) => style.remove());
  browser.happyDOM.setWindowSize(initialSize);
});

for (const optimize of [true, false]) {
  it(`runs the self-contained grouped app at viewport boundaries, optimize=${optimize}`, async () => {
    const build = await Bun.build({
      entrypoints: [`${root}/main.ts`], target: 'browser', external: ['@memoized-dom/*'],
      plugins: [memoizedDom({ root, client: './main.ts', languages: [auwla], optimize })],
    });
    expect(build.success).toBe(true);
    const css = await build.outputs.find((output) => output.path.endsWith('.css'))!.text();
    expect(css).not.toMatch(/@(?:700|900|1000|\.)/);
    const code = await build.outputs.find((output) => output.path.endsWith('.js'))!.text();
    expect(code).not.toContain('min-width');
    expect(code).not.toContain('matchMedia');
    const module = toModuleFunction(code);
    const imports = module.specifiers.map((specifier) => {
      expect(specifier).toBe('@memoized-dom/runtime');
      return runtime;
    });

    for (const width of [299, 300, 699, 700, 899, 900, 1000]) {
      browser.happyDOM.setWindowSize({ width, height: 800 });
      // Fresh stylesheet ownership avoids Happy DOM's viewport-style cache.
      const style = document.createElement('style');
      style.dataset.groupTest = '';
      style.textContent = css;
      document.head.append(style);
      const container = document.createElement('div');
      container.id = 'app';
      document.body.append(container);
      runtime.setScheduler((run) => run());
      const exports: Record<string, unknown> = {};
      new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
        imports, exports, () => {}, ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
      );
      applications.push(exports.application as runtime.MountedApplication);
      const cards = [...container.querySelectorAll<HTMLElement>('.card')];
      expect(cards).toHaveLength(3);
      const padding = width >= 900 ? '28px' : width >= 700 ? '24px' : width >= 300 ? '12px' : '8px';
      for (const card of cards) {
        expect(getComputedStyle(card).paddingTop).toBe(padding);
        expect(getComputedStyle(card).borderTopWidth).toBe('2px');
        expect(getComputedStyle(card).borderTopColor).toBe(width >= 700 ? '#2563eb' : '#64748b');
        expect(getComputedStyle(card.querySelector('h2')!).fontSize).toBe(width >= 700 ? '24px' : '16px');
      }
      const columns = getComputedStyle(container.querySelector('.grid')!).gridTemplateColumns.replaceAll(' ', '');
      expect(columns).toBe(width >= 1000 ? 'repeat(3,minmax(0,1fr))' : width >= 700 ? 'repeat(2,minmax(0,1fr))' : '1fr');
      expect(getComputedStyle(container.querySelector('.order')!).paddingTop).toBe('16px');
      expect(getComputedStyle(container.querySelector('.reverse')!).paddingTop).toBe(width >= 300 ? '12px' : '4px');
      cards[0]!.querySelector('button')!.click();
      expect(getComputedStyle(cards[0]!).paddingTop).toBe(width >= 700 ? '36px' : padding);
      expect(getComputedStyle(cards[1]!).paddingTop).toBe(padding);
      cards[0]!.querySelector('button')!.click();
      expect(getComputedStyle(cards[0]!).paddingTop).toBe(padding);
      applications.pop()!.unmount();
      container.remove();
      style.remove();
    }
  });
}

it('provides native CSS assistance in its own authored fixture files', () => {
  for (const name of ['App.auwla', 'Card.auwla', 'shared.auwla']) {
    const source = readFileSync(`${root}/${name}`, 'utf8');
    expect(createCssSession(source, `file://${root}/${name}`)!.diagnostics()).toEqual([]);
  }
});
