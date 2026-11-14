import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from 'css-tree';
import type { Window } from 'happy-dom';
import { compileModulesDetailed } from '@memoized-dom/compiler-next';
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { auwla, normalize } from '../src';
import { parseStylesheet } from '../src/styles/syntax';
import { createCssSession } from '../src/styles/tooling';
import fixtures from '../../../wiki2/spec/style-responsive.cases.json';

function canonical(source: string): string {
  return generate(parseStylesheet(source));
}

for (const fixture of fixtures.cases) {
  it(`${fixture.id}: compact numeric viewport conformance`, () => {
    const source = `<style global>${fixture.source}</style>`;
    if (fixture.error !== undefined) {
      expect(() => normalize(source)).toThrow(fixture.error);
    } else {
      expect(canonical(normalize(source).stylesheet!)).toBe(canonical(fixture.css!));
    }
  });
}

it('makes bare pixels equivalent to explicit pixels, including zero and decimal thresholds', () => {
  for (const threshold of ['0', '300', '700', '.5', '700.5', '+700', '1e3']) {
    const bare = normalize(`<style>.a { padding:4px @${threshold}:8px; }</style>`, { filename: './App.auwla' });
    const explicit = normalize(`<style>.a { padding:4px @${threshold}px:8px; }</style>`, { filename: './App.auwla' });
    expect(bare.stylesheet).toBe(explicit.stylesheet);
  }
});

it('preserves numeric markers inside native token contexts', () => {
  const css = String.raw`.a {
    content:"@700:literal";
    /* @300:comment */
    background:url(icon@700.svg);
    --tokens:{@700:x; [@300:y]};
    --function:future(@700:value);
    --brackets:[@700:value];
  }`;
  expect(normalize(`<style global>${css}</style>`).stylesheet).toBe(css);
  expect(normalize(`<style global>${css} .b {padding:4px @700:8px;}</style>`).stylesheet).toContain(css);
});

it('reports malformed thresholds and context at the original source positions', () => {
  const source = 'const emoji = "😀";\r\n<style global>\r\n.a { padding:4px @-700px:8px; }\r\n</style>';
  expect(() => compileModulesDetailed({ './Card.auwla': source }, { languages: [auwla] }))
    .toThrow('./Card.auwla:3:18');
  const session = createCssSession(source, 'file:///Card.auwla')!;
  expect(session.diagnostics()).toContainEqual(expect.objectContaining({
    code: 'CSS2001',
    range: { start: { line: 2, character: 17 }, end: { line: 2, character: 24 } },
  }));
  for (const css of [
    '.a {padding:4px @700 px:8px;}',
    '.a {padding:4px @1.2.3px:8px;}',
    '.a {padding:4px @700:8px !wrong;}',
    '.a {padding:4px @700:8px !important @900:12px;}',
    '.a {padding:4px @700:8px;',
    '.a {@media (min-width:1px) {padding:4px @700:8px;}}',
    '.a {@700 {padding:8px;}}',
  ]) {
    expect(() => normalize(`<style global>${css}</style>`)).toThrow();
  }
});

it('keeps native value completion edits, property hover and unrelated errors scoped to authored CSS', () => {
  const source = 'const emoji = "😀";\r\n<style>\r\n.card { color:black @700px:re; padding:4px @300:8px; }\r\n.bad { unknown-property:red; }\r\n</style>';
  const session = createCssSession(source, 'file:///Card.auwla')!;
  const red = session.complete(source.indexOf(':re;') + 3)!.items.find((item) => item.label === 'red')!;
  expect(red.textEdit).toMatchObject({
    range: { start: { line: 2, character: 27 }, end: { line: 2, character: 29 } }, newText: 'red',
  });
  expect(session.hover(source.indexOf('color:'))).toBeTruthy();
  expect(session.diagnostics()).toEqual([expect.objectContaining({
    code: 'unknownProperties', range: { start: { line: 3, character: 7 }, end: { line: 3, character: 23 } },
  })]);
});

it('retains bounded CSS assistance through every prefix of numeric headers and values', () => {
  for (const css of [
    '.card {padding:4px @700px:8px @.expanded:24px; color:navy;}',
    '.card {.title {font-size:1rem @40rem:2rem;}}',
  ]) {
    for (let end = 0; end <= css.length; end++) {
      const source = `<style>${css.slice(0, end)}</style>`;
      const session = createCssSession(source, 'file:///Card.auwla')!;
      expect(session).toBeDefined();
      session.diagnostics();
      session.complete('<style>'.length + end);
    }
  }
  for (const header of ['@700', '@700p', '@700px', '@700px:']) {
    const source = `<style>.a {color:black ${header};} .b {color:red;}</style>`;
    const diagnostics = createCssSession(source, 'file:///Card.auwla')!.diagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('CSS2001');
  }
});

const root = fileURLToPath(new URL('../examples/responsive/', import.meta.url));
const browser = window as unknown as Window;
const initialSize = { width: browser.innerWidth, height: browser.innerHeight };
const applications: runtime.MountedApplication[] = [];

afterEach(() => {
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  runtime.resetScheduler();
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-responsive-test]').forEach((node) => node.remove());
  browser.happyDOM.setWindowSize(initialSize);
});

for (const optimize of [true, false]) {
  it(`runs the real responsive example at viewport boundaries, optimize=${optimize}`, async () => {
    const result = await Bun.build({
      entrypoints: [`${root}/main.ts`],
      target: 'browser',
      external: ['@memoized-dom/*'],
      plugins: [memoizedDom({ root, client: './main.ts', languages: [auwla], optimize })],
    });
    expect(result.success).toBe(true);
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))!.text();
    expect(css).toContain('@media');
    expect(css).not.toMatch(/@(?:300|700|1000|\.)/);
    const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
    expect(code).not.toContain('matchMedia');
    expect(code).not.toContain('min-width');
    const module = toModuleFunction(code);
    const imports = module.specifiers.map((specifier) => {
      expect(specifier).toBe('@memoized-dom/runtime');
      return runtime;
    });

    for (const width of [299, 300, 699, 700, 1000]) {
      browser.happyDOM.setWindowSize({ width, height: 800 });
      // Happy DOM caches computed styles across viewport changes. New stylesheet
      // ownership per boundary uses its native media matcher without stale results.
      const style = document.createElement('style');
      style.dataset.responsiveTest = '';
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
      expect(getComputedStyle(document.body).fontFamily).toContain('system-ui');
      expect(getComputedStyle(document.body).backgroundColor).toBe('#f1f5f9');
      const padding = width >= 700 ? '24px' : width >= 300 ? '12px' : '8px';
      for (const card of cards) {
        expect(getComputedStyle(card).paddingTop).toBe(padding);
        expect(getComputedStyle(card).borderTopWidth).toBe('2px');
        expect(getComputedStyle(card).backgroundColor).toBe('white');
        expect(getComputedStyle(card.querySelector('button')!).backgroundColor).toBe('#2563eb');
        expect(getComputedStyle(card).borderTopColor).toBe(width >= 700 ? '#2563eb' : '#64748b');
        expect(getComputedStyle(card.querySelector('h2')!).fontSize).toBe(width >= 700 ? '24px' : '16px');
      }
      expect(getComputedStyle(container.querySelector('.order')!).paddingTop).toBe(width >= 300 ? '12px' : '4px');
      cards[0]!.querySelector('button')!.click();
      expect(getComputedStyle(cards[0]!).paddingTop).toBe('36px');
      expect(getComputedStyle(cards[1]!).paddingTop).toBe(padding);
      expect(cards[0]!.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
      cards[0]!.querySelector('button')!.click();
      expect(getComputedStyle(cards[0]!).paddingTop).toBe(padding);

      applications.pop()!.unmount();
      container.remove();
      style.remove();
    }
  });
}

it('keeps responsive declarations in the real authoring files and their native assistance', () => {
  for (const name of ['App.auwla', 'Card.auwla', 'shared.auwla']) {
    const source = readFileSync(`${root}/${name}`, 'utf8');
    expect(createCssSession(source, `file://${root}/${name}`)!.diagnostics()).toEqual([]);
  }
});
