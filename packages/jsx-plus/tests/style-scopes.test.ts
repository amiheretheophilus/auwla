import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModulesDetailed, createProject, fileSystemHost } from '@memoized-dom/compiler-next';
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { renderToString } from '../../server/src/index';
import { auwla, normalize } from '../src';
import { authoredOffset } from '../src/source';
import { createCssSession } from '../src/styles/tooling';
import { projectForChecking } from '../src/checking/project';
import cases from '../../../wiki2/spec/style-scopes.cases.json';
import { normalizeForLanguage } from '../src/normalize';

const root = fileURLToPath(new URL('../examples/scoping/', import.meta.url));
const applications: runtime.MountedApplication[] = [];

for (const fixture of cases.cases) {
  it(`${fixture.id}: scope profile conformance`, () => {
    if (fixture.error !== undefined) {
      expect(() => normalize(fixture.source)).toThrow(fixture.error);
      return;
    }
    const result = normalize(fixture.source);
    const stylesheet = result.stylesheet!.trim().replace(/data-mmd-s-[\w-]+/g, 'SCOPE');
    expect(stylesheet).toBe(fixture.stylesheet!);
    expect(result.code.match(/data-mmd-s-[\w-]+=/g) ?? []).toHaveLength(fixture.elements!);
  });
}

afterEach(() => {
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  runtime.resetScheduler();
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-scope-test]').forEach((node) => node.remove());
});

function applyCss(css: string): void {
  const style = document.createElement('style');
  style.dataset.scopeTest = '';
  style.textContent = css;
  document.head.append(style);
}

function execute(code: string): Record<string, unknown> {
  const module = toModuleFunction(code);
  const imports = module.specifiers.map((specifier) => {
    if (specifier.endsWith('.css')) {
      return {};
    }
    expect(specifier).toBe('@memoized-dom/runtime');
    return runtime;
  });
  const exports: Record<string, unknown> = {};
  new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
    imports, exports, () => {}, ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
  );
  return exports;
}

function scopeAttributes(element: Element): string[] {
  return element.getAttributeNames().filter((name) => name.startsWith('data-mmd-s-')).sort();
}

for (const optimize of [true, false]) {
  it(`runs the real multi-file scope gallery and keeps class updates independent, optimize=${optimize}`, async () => {
    const result = await Bun.build({
      entrypoints: [`${root}/main.ts`], target: 'browser', external: ['@memoized-dom/*'],
      plugins: [memoizedDom({ root, client: './main.ts', languages: [auwla], optimize })],
    });
    expect(result.success).toBe(true);
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))!.text();
    expect(css).not.toContain('@use');
    expect(css).not.toContain('@.');
    expect(css).toContain(':where([data-mmd-s-');
    applyCss(css);

    const container = document.createElement('div');
    container.id = 'app';
    document.body.append(container);
    runtime.setScheduler((run) => run());
    const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
    applications.push(execute(code).application as runtime.MountedApplication);

    const teal = container.querySelector<HTMLElement>('[data-card="teal"]')!;
    const gold = container.querySelector<HTMLElement>('[data-card="gold"]')!;
    const independent = container.querySelector<HTMLElement>('[data-card="independent"]')!;
    const nested = container.querySelector<HTMLElement>('[data-card="nested"]')!;
    expect(getComputedStyle(container.querySelector('h1')!).color).toBe('maroon');
    expect(getComputedStyle(teal.querySelector('.title')!).color).toBe('teal');
    // Bun shortens these native color names in its delivered stylesheet.
    expect(getComputedStyle(gold.querySelector('.title')!).color).toBe('#daa520');
    expect(getComputedStyle(independent.querySelector('.title')!).color).toBe('#639');
    expect(getComputedStyle(nested.querySelector('.title')!).color).not.toBe('maroon');
    expect(scopeAttributes(nested.querySelector('.title')!)).toEqual([]);
    expect(getComputedStyle(teal.querySelector('.file-note')!).fontWeight).toBe('700');
    expect(getComputedStyle(gold.querySelector('.file-note')!).fontWeight).toBe('700');
    expect(getComputedStyle(independent.querySelector('.file-note')!).fontWeight).not.toBe('700');
    expect(getComputedStyle(teal.querySelector('.file-note')!).fontStyle).not.toBe('italic');
    expect(getComputedStyle(teal.querySelector('.tag')!).color).toBe('teal');
    expect(scopeAttributes(teal)).not.toEqual(scopeAttributes(gold));
    expect(scopeAttributes(teal).filter((attribute) => gold.hasAttribute(attribute))).toHaveLength(1);

    const button = teal.querySelector('button')!;
    expect(getComputedStyle(teal).paddingTop).toBe('16px');
    expect(getComputedStyle(gold).paddingTop).toBe('16px');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(teal.querySelector('.status')!.textContent).toBe('Expanded: true');
    expect(getComputedStyle(teal).paddingTop).toBe('32px');
    expect(getComputedStyle(gold).paddingTop).toBe('16px');
    expect(getComputedStyle(independent).paddingTop).toBe('10px');
    button.click();
    expect(getComputedStyle(teal).paddingTop).toBe('16px');
    expect(container.querySelector('style')).toBeNull();
  });

  it(`keeps slot fallback and projected children in their author's scope, optimize=${optimize}`, () => {
    const source = `export function Frame({ children }) {
      <style>.title { color: teal; }</style>
      return <section><slot><h2 class="title" data-title="fallback">"Fallback"</h2></slot></section>;
    }
    export function App() {
      <style>.title { color: maroon; }</style>
      return (
        <main>
          <Frame />
          <Frame><h2 class="title" data-title="projected">"Projected"</h2></Frame>
        </main>
      );
    }`;
    const result = compileModulesDetailed({ './Slots.auwla': source }, { languages: [auwla], optimize });
    applyCss(result.css!['./Slots.auwla.css']!);
    const { App } = execute(result.output['./Slots.auwla']!);
    const container = document.createElement('div');
    document.body.append(container);
    applications.push(runtime.mount(container, App as () => unknown));
    const fallback = container.querySelector('[data-title="fallback"]')!;
    const projected = container.querySelector('[data-title="projected"]')!;
    expect(getComputedStyle(fallback).color).toBe('teal');
    expect(getComputedStyle(projected).color).toBe('maroon');
    expect(scopeAttributes(fallback)).not.toEqual(scopeAttributes(projected));
  });
}

it('preserves authored mappings, checking scopes and markers across CSS-only edits', () => {
  const source = readFileSync(`${root}/Cards.auwla`, 'utf8');
  const normalized = normalizeForLanguage(source, './Cards.auwla');
  for (const text of ['expanded = false', 'expanded = !expanded']) {
    const offset = normalized.code.indexOf(text);
    expect(authoredOffset(normalized.mappings, offset)).toBe(source.indexOf(text));
  }
  const changed = normalizeForLanguage(source.replace('color: teal;', 'color: rebeccapurple;'), './Cards.auwla');
  const markers = (code: string) => [...new Set(code.match(/data-mmd-s-[\w-]+/g))].sort();
  expect(markers(normalized.code)).toEqual(markers(changed.code));
  const checking = projectForChecking(source, './Cards.auwla');
  expect(checking.diagnostics ?? []).toEqual([]);
  expect(checking.text).not.toContain('@use');
  expect(checking.text).not.toContain('data-mmd-s-');
});

it('keeps native selector specificity, ancestor qualifiers, pseudo-elements and grouping', () => {
  const source = `<style>
    /* native values stay unchanged */
    body.dark .card:hover, .card::before { --future: custom(1); content: "a;b"; }
    .card { & > .title { color: teal; } }
    @media (min-width: 40rem) { .title:is(h1,h2) { color: navy; } }
  </style>
  export function App() { return <main class="card"><h1 class="title">"Title"</h1></main>; }`;
  const css = normalize(source).stylesheet!;
  expect(css).toContain('/* native values stay unchanged */');
  expect(css).toMatch(/body.dark \.card:hover:where\(\[data-mmd-s-[\w-]+\]\)/);
  expect(css).toMatch(/\.card:where\(\[data-mmd-s-[\w-]+\]\)::before/);
  expect(css).toMatch(/&>\.title:where\(\[data-mmd-s-[\w-]+\]\)/);
  expect(css).toContain('@media (min-width: 40rem)');
  expect(css).toContain('--future: custom(1); content: "a;b";');
});

it('leaves ordinary cascade specificity intact and does not forward private attributes to components', () => {
  const source = `export function Child(props) {
    return <p data-child=(Object.keys(props).join(","))>"Child"</p>;
  }
  export function App() {
    <style>.title {color:teal}</style>
    <style global>.title {color:navy}</style>
    return <main><h1 class="title">"Title"</h1><Child /></main>;
  }`;
  const result = compileModulesDetailed({ './App.auwla': source }, { languages: [auwla] });
  applyCss(result.css!['./App.auwla.css']!);
  const { App } = execute(result.output['./App.auwla']!);
  const container = document.createElement('div');
  document.body.append(container);
  applications.push(runtime.mount(container, App as () => unknown));
  expect(getComputedStyle(container.querySelector('.title')!).color).toBe('navy');
  expect(container.querySelector('[data-child]')!.getAttribute('data-child')).not.toContain('data-mmd-s-');
});

it('keeps external ancestor qualifiers equivalent under native nesting and scopes inherited declarations in order', () => {
  const source = `<style>
    body.dark {
      color: red;
      @media (min-width: 40rem) {
        color: blue;
        & .title {color:teal}
      }
      color: green;
      & .note {color:navy}
    }
  </style>
  export function App(){ return <h1 class="title">"Title"</h1>; }`;
  const css = normalize(source).stylesheet!.replace(/data-mmd-s-[\w-]+/g, 'SCOPE');
  expect(css).toContain('body.dark {');
  expect(css).not.toContain('body.dark:where');
  expect(css).toContain('& .title:where([SCOPE]) {color:teal}');
  expect(css).toContain('& .note:where([SCOPE]) {color:navy}');
  // Explicit body declarations must reach body; descendants still need markers.
  expect(css.match(/&:where\(\[SCOPE\],body.dark\)/g)).toHaveLength(3);
  expect(css.indexOf('color: red')).toBeLessThan(css.indexOf('color: blue'));
  expect(css.indexOf('color: blue')).toBeLessThan(css.indexOf('color:teal'));
  expect(css.indexOf('color:teal')).toBeLessThan(css.indexOf('color: green'));
  expect(css.indexOf('color: green')).toBeLessThan(css.indexOf('color:navy'));
  expect(createCssSession(`<style global>${css}</style>`, 'file:///App.auwla')!.diagnostics()).toEqual([]);
  const implicit = normalize(source.replaceAll('& .title', '.title').replaceAll('& .note', '.note')).stylesheet!
    .replace(/data-mmd-s-[\w-]+/g, 'SCOPE');
  expect(implicit).toBe(css.replaceAll('& .title', '.title').replaceAll('& .note', '.note'));
  expect(() => normalize('<style>.a { & .b {color:red}</style>')).toThrow('A local style requires a closing }');
});

it('accepts implicit local nesting without misreading type/pseudo selectors as declarations', () => {
  for (const css of ['.a { .b {color:red} }', '.a { h2:hover {color:red} color:green; }']) {
    expect(normalize(`<style>${css}</style>`).stylesheet).toContain(':where([data-mmd-s-');
    expect(normalize(`<style global>${css}</style>`).stylesheet).toBe(css);
  }
  const css = '.a { --future:{nested:tokens}; content:"{literal}"; background:url("{icon}.svg"); }';
  expect(normalize(`<style>${css}</style>`).stylesheet).toContain('--future:{nested:tokens}');
  const conditional = normalize('<style>.card { color:red @.loading:blue; & .title {color:teal} }</style>').stylesheet!;
  expect(conditional).not.toContain('@.');
  expect(conditional).toMatch(/&:where\(\[data-mmd-s-[\w-]+\]\)\.loading/);
  expect(createCssSession(`<style global>${conditional}</style>`, 'file:///App.auwla')!.diagnostics()).toEqual([]);
});

it('keeps intentional document targets reachable while scoping mixed and descendant subjects', () => {
  const source = `<style>
    :root {--accent:navy;}
    html[lang], body.dark, .card {color:var(--accent);}
    body .title {color:teal;}
    body::before {content:"Document";}
    :is(body, .shared):not(.hidden) {padding:8px;}
    :where(:root, .frame) {margin:0;}
    :not(body), :has(body) {border:0;}
  </style>
  export function App(){ return <section class="card"><h1 class="title">"Title"</h1></section>; }`;
  const css = normalize(source).stylesheet!.replace(/data-mmd-s-[\w-]+/g, 'SCOPE');
  expect(css).toContain(':root {--accent:navy;}');
  expect(css).toContain('html[lang],body.dark,.card:where([SCOPE])');
  expect(css).toContain('body .title:where([SCOPE])');
  expect(css).toContain('body::before {content:"Document";}');
  expect(css).toContain(':is(body,.shared:where([SCOPE])):not(.hidden)');
  expect(css).toContain(':where(:root,.frame:where([SCOPE]))');
  expect(css).toContain(':not(body):where([SCOPE]),:has(body):where([SCOPE])');
});

it('propagates explicit document subjects through nested & without unscoping descendant cards', () => {
  const source = `<style>
    body.dark, .frame {
      padding:8px;
      &.ready {color:navy;}
      .title {color:teal;}
      @media (min-width:1px) {margin:0;}
    }
  </style>`;
  const css = normalize(source).stylesheet!.replace(/data-mmd-s-[\w-]+/g, 'SCOPE');
  expect(css).toContain('&:where([SCOPE],body.dark){');
  expect(css).toContain('&.ready:where([SCOPE],body.dark)');
  expect(css).toContain('.title:where([SCOPE])');
  expect(css).not.toContain('.title:where([SCOPE],body.dark)');
});

for (const optimize of [true, false]) {
  it(`applies root variables and body typography without leaking local selectors, optimize=${optimize}`, () => {
    const source = `<style>
      :root {--scope-accent:navy;}
      body {font-family:system-ui,sans-serif;}
      .card {color:var(--scope-accent);background:var(--scope-accent);}
      :is(body, .card) {padding:11px;}
    </style>
    export function App(){return <button class="card">"Visible button"</button>;}`;
    const result = compileModulesDetailed({ './App.auwla': source }, { languages: [auwla], optimize });
    applyCss(result.css!['./App.auwla.css']!);
    const { App } = execute(result.output['./App.auwla']!);
    const container = document.createElement('div');
    const outside = document.createElement('button');
    outside.className = 'card';
    document.body.append(container, outside);
    applications.push(runtime.mount(container, App as () => unknown));
    const button = container.querySelector('button')!;
    expect(getComputedStyle(document.documentElement).getPropertyValue('--scope-accent')).toBe('navy');
    expect(getComputedStyle(document.body).fontFamily).toContain('system-ui');
    expect(getComputedStyle(document.body).paddingTop).toBe('11px');
    expect(getComputedStyle(button).color).toBe('navy');
    expect(getComputedStyle(button).backgroundColor).toBe('navy');
    expect(getComputedStyle(button).paddingTop).toBe('11px');
    expect(getComputedStyle(outside).backgroundColor).not.toBe('navy');
    expect(getComputedStyle(outside).paddingTop).not.toBe('11px');
  });
}

it('uses the same static scope markers in server markup and client rendering, including SVG', () => {
  const source = `export function App() {
    <style>svg {color:teal} path {fill:currentColor}</style>
    return <svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>;
  }`;
  const result = compileModulesDetailed({ './Icon.auwla': source }, { languages: [auwla] });
  const { App } = execute(result.output['./Icon.auwla']!);
  const component = App as () => Node;
  const html = renderToString(component);
  const server = document.createElement('div');
  server.innerHTML = html;
  const client = document.createElement('div');
  document.body.append(client);
  applications.push(runtime.mount(client, component));
  for (const tag of ['svg', 'path']) {
    const serverElement = server.querySelector(tag)!;
    const clientElement = client.querySelector(tag)!;
    expect(scopeAttributes(serverElement)).toHaveLength(1);
    expect(scopeAttributes(serverElement)).toEqual(scopeAttributes(clientElement));
    expect(clientElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
  }
});

it('does not emit unused named rules and retains explicit use order', () => {
  const source = `<style id="unused">.unused {color:pink}</style>
  <style id="base">.title {color:teal}</style>
  <style>@use("./App.auwla", "base"); .title{color:navy} @use("./App.auwla", "base");</style>
  export function App(){ return <h1 class="title">"Title"</h1>; }`;
  const css = normalize(source).stylesheet!;
  expect(css).not.toContain('.unused');
  expect(css.match(/color:teal/g)).toHaveLength(2);
  expect(css.indexOf('color:navy')).toBeGreaterThan(css.indexOf('color:teal'));
  expect(css.indexOf('color:navy')).toBeLessThan(css.lastIndexOf('color:teal'));
});

it('rejects duplicate, missing, cyclic, nested and unresolved style uses at authored locations', () => {
  expect(() => normalize('<style id="a">.a{}</style>\n<style id="a">.b{}</style>')).toThrow('Duplicate style id');
  expect(() => normalize('<style>@use("./App.auwla", "missing");</style>')).toThrow('No named style');
  expect(() => normalize('<style id="a">@use("./App.auwla", "b");</style><style id="b">@use("./App.auwla", "a");</style>'))
    .toThrow('Cyclic style use: a -> b -> a');
  expect(() => normalize('<style>@use("./Other.auwla", "a");</style>')).toThrow('Cross-file @use');
  expect(() => normalize('<style>.a { @use("./App.auwla", "a"); }</style>')).toThrow('at stylesheet level');
  expect(() => normalize('<style>@use("./App.auwla#id");</style>')).toThrow('CSS3001');
  const source = '<style id="base">\n.a { color:red @.loading:; }\n</style>\n<style>@use("./App.auwla", "base");</style>';
  expect(() => normalize(source)).toThrow('./App.auwla:2:16');
});

it('recognizes declaration placement without capturing DOM style elements or conditional CSS', () => {
  const arrow = 'export const Card = () => { <style>.title{color:teal}</style> return <h2 class="title">"Title"</h2>; };';
  expect(normalize(arrow).stylesheet).toContain(':where([data-mmd-s-');
  expect(() => normalize('function App(){ if(true){ <style>.a{color:red}</style> } return <div/>; }'))
    .toThrow('CSS1003');
  expect(() => normalize('function App(){ <style id="private">.a{}</style> return <div/>; }')).toThrow('CSS1001');
  const global = normalize('function App(){ <style global>body{color:red}</style> return <div/>; }');
  expect(global.stylesheet).toBe('body{color:red}');
  expect(global.code).not.toContain('data-mmd-s-');
  const dom = normalize('const css = "body{color:red}"; export function App(){ return <style>css</style>; }');
  expect(dom.stylesheet).toBeUndefined();
  expect(dom.code).toContain('<style>{css}</style>');
});

it('requires explicit global consumers for resources without defined local scoping', () => {
  for (const css of ['@keyframes fade {from{opacity:0}to{opacity:1}}', '@font-face {font-family: Demo;src:url(font.woff2)}', '@import "./reset.css";']) {
    expect(() => normalize(`<style>${css}</style>`)).toThrow('CSS3002');
    expect(normalize(`<style global>${css}</style>`).stylesheet).toBe(css);
  }
});

it('maps compiler-owned slot errors through scoped normalization to the authored file', () => {
  const source = `export function App() {
    <style>.title {color:teal}</style>
    const label = "title";
    return <section><h1>"Heading"</h1><slot name=(label) /></section>;
  }`;
  let error;
  try {
    normalize(source, { filename: './Slots.auwla' });
  } catch (problem) {
    error = problem;
  }
  expect(error).toMatchObject({ filename: './Slots.auwla', line: 4 });
  expect((error as Error).message).toContain('must be a static name');
  expect((error as Error).message).not.toContain('Markup.tsx');
});

it('offers CSS assistance in named and component blocks without treating @use as native @import', () => {
  const source = readFileSync(`${root}/Cards.auwla`, 'utf8');
  const session = createCssSession(source, 'file:///Cards.auwla')!;
  expect(session.diagnostics()).toEqual([]);
  const spaced = source.replaceAll('./Cards.auwla', './My Cards.auwla');
  expect(createCssSession(spaced, 'file:///My%20Cards.auwla')!.diagnostics()).toEqual([]);
  expect(session.hover(source.indexOf('border-color:'))).toBeTruthy();
  const edited = source.replace('border-color: teal;', 'border-col');
  const completion = createCssSession(edited, 'file:///Cards.auwla')!.complete(edited.indexOf('border-col') + 10)!;
  expect(completion.items.some((item) => item.label === 'border-color')).toBe(true);
  const invalid = '<style>\n@use("./App.auwla");\n.a {color:red}\n</style>';
  expect(createCssSession(invalid, 'file:///App.auwla')!.diagnostics()).toContainEqual(expect.objectContaining({
    code: 'CSS3001', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } },
  }));
  const missing = '<style>\n@use("./App.auwla", "missing");\n</style>';
  expect(createCssSession(missing, 'file:///App.auwla')!.diagnostics()).toEqual([
    expect.objectContaining({ code: 'CSS3001', message: 'No named style "missing" in ./App.auwla' }),
  ]);
  const unfinished = 'export function App(){\n<style>\n.card { padd';
  const partial = createCssSession(unfinished, 'file:///App.auwla')!;
  expect(partial.complete(unfinished.length)!.items.some((item) => item.label === 'padding')).toBe(true);
});

it('delivers one scoped CSS companion per source module through the existing project', async () => {
  const project = createProject({ entries: ['./main.ts'], host: fileSystemHost(root), languages: [auwla] });
  const result = await project.build();
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(Object.keys(result.css!).sort()).toEqual(['./App.auwla.css', './Cards.auwla.css', './IndependentCard.auwla.css']);
  expect(result.css!['./Cards.auwla.css']).not.toContain('@use');
  expect(result.output['./Cards.auwla']).not.toContain('padding:');
});
