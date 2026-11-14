import { afterAll, afterEach, expect, it } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { compileModulesDetailed, createProject } from '@memoized-dom/compiler-next';
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { auwla } from '../src';
import { rebaseStyleUrls } from '../src/styles/urls';
import { createCssSession } from '../src/styles/tooling';

const root = resolve(import.meta.dir, '../examples/scoping');
const paths = ['main.ts', 'App.auwla', 'Cards.auwla', 'IndependentCard.auwla', 'styles/Frames.auwla', 'styles/Palette.auwla'];
const sources = Object.fromEntries(paths.map((path) => [`./${path}`, readFileSync(join(root, path), 'utf8')]));
const consumer = `export function App() {
  <style>@use("./styles/Frames.auwla", "card-frame");</style>
  return <article class="card"><h2 class="title">"Title"</h2></article>;
}`;
const copies: string[] = [];
const applications: runtime.MountedApplication[] = [];

afterEach(() => {
  for (const application of applications.splice(0)) application.unmount();
  runtime.resetScheduler();
  document.body.replaceChildren();
});
afterAll(() => {
  const prefix = resolve(import.meta.dir, '..') + sep + '.style-reuse-';
  for (const copy of copies) {
    if (!resolve(copy).startsWith(prefix)) throw new Error('Unexpected test cleanup path');
    rmSync(copy, { recursive: true, force: true });
  }
});

function assets(overrides: Record<string, string> = {}) {
  return {
    './styles/Frames.auwla': sources['./styles/Frames.auwla']!,
    './styles/Palette.auwla': sources['./styles/Palette.auwla']!,
    ...overrides,
  };
}

it('links transitive named definitions into the consumer scope and rebases their assets', () => {
  const result = compileModulesDetailed({ './Panel.auwla': consumer }, { languages: [auwla], assetSources: assets() });
  expect(Object.keys(result.output)).toEqual(['./Panel.auwla']);
  expect(Object.keys(result.css!)).toEqual(['./Panel.auwla.css']);
  const css = result.css!['./Panel.auwla.css']!;
  expect(css).toContain('./styles/assets/dot.svg');
  expect(css).not.toContain('@use');
  expect(css).not.toContain('@.');
  const attributes = [...new Set(result.output['./Panel.auwla']!.match(/data-mmd-s-[\w-]+/g))];
  expect(attributes).toHaveLength(1);
  expect([...new Set(css.match(/data-mmd-s-[\w-]+/g))]).toEqual(attributes);
});

it('resolves aliases and retains identical IDs in separate source modules', () => {
  const result = compileModulesDetailed({ './Panel.auwla': consumer.replace('./styles/Frames.auwla', '#frames') }, {
    languages: [auwla], assetSources: assets(),
    resolveImport: (specifier) => specifier === '#frames' ? './styles/Frames.auwla' : undefined,
  });
  expect(result.css!['./Panel.auwla.css']).toContain('padding:16px');
  const repeated = compileModulesDetailed({ './Panel.auwla': '<style>@use("./a.auwla", "look");@use("./b.auwla", "look");</style>' }, {
    languages: [auwla], assetSources: {
      './a.auwla': '<style id="look">.a{color:teal}</style>',
      './b.auwla': '<style id="look">.b{color:navy}</style>',
    },
  });
  expect(repeated.css!['./Panel.auwla.css']).toContain('color:teal');
  expect(repeated.css!['./Panel.auwla.css']).toContain('color:navy');
});

it('reports missing sources, IDs, duplicate definitions and cycles in the authored file', () => {
  const joined = '<style>@use("./Theme.auwla", "look");</style>\nexport function App(){return <p>"a" <p>"b"</p></p>;}';
  expect(() => compileModulesDetailed({ './Panel.auwla': joined }, { languages: [auwla] })).toThrow('JPX1005');
  expect(() => compileModulesDetailed({ './Panel.auwla': consumer }, { languages: [auwla] }))
    .toThrow('./Panel.auwla:2:');
  expect(() => compileModulesDetailed({ './Panel.auwla': consumer }, {
    languages: [auwla], assetSources: assets({ './styles/Frames.auwla': '<style id="other">.a{}</style>' }),
  })).toThrow('No named style "card-frame"');
  expect(() => compileModulesDetailed({ './Panel.auwla': consumer }, {
    languages: [auwla], assetSources: assets({ './styles/Frames.auwla': '<style id="card-frame">.a{}</style>\n<style id="card-frame">.b{}</style>' }),
  })).toThrow('./styles/Frames.auwla:2:1');

  const cyclic = assets({
    './styles/Frames.auwla': '<style id="card-frame">@use("./Palette.auwla", "look");</style>',
    './styles/Palette.auwla': '<style id="look">@use("./Frames.auwla", "card-frame");</style>',
  });
  expect(() => compileModulesDetailed({ './Panel.auwla': consumer }, { languages: [auwla], assetSources: cyclic }))
    .toThrow('./styles/Palette.auwla:1:');
  expect(() => compileModulesDetailed({ './Panel.auwla': consumer }, { languages: [auwla], assetSources: cyclic }))
    .toThrow('./styles/Frames.auwla (card-frame)');
  const malformed = assets({ './styles/Palette.auwla': '<style id="palette">\n.card{color:red @.loading:;}\n</style>' });
  expect(() => compileModulesDetailed({ './Panel.auwla': consumer }, { languages: [auwla], assetSources: malformed }))
    .toThrow('./styles/Palette.auwla:2:');
});

it('updates both real consumers through CSS, caches JS reads, prunes sources and recovers after deletion', async () => {
  const files = { ...sources };
  const reads = new Map<string, number>();
  const project = createProject({ entries: ['./main.ts'], languages: [auwla], host: {
    readFile(path) { reads.set(path, (reads.get(path) ?? 0) + 1); return files[path]; },
  } });
  const first = await project.build();
  expect(first.ok).toBe(true);
  if (!first.ok) throw first.error;
  expect(first.modules).toContain('./styles/Frames.auwla');
  expect(first.modules).toContain('./styles/Palette.auwla');
  expect(Object.keys(first.output)).not.toContain('./styles/Frames.auwla');
  const before = new Map(reads);
  files['./styles/Frames.auwla'] = files['./styles/Frames.auwla']!.replace('32px', '400px');
  const changed = await project.update(['./styles/Frames.auwla']);
  expect(changed.build.ok).toBe(true);
  expect([...changed.changed].sort()).toEqual(['./Cards.auwla.css', './IndependentCard.auwla.css']);
  for (const path of ['./main.ts', './App.auwla', './Cards.auwla', './IndependentCard.auwla', './styles/Palette.auwla']) {
    expect(reads.get(path)).toBe(before.get(path));
  }
  const updated = files['./styles/Frames.auwla']!;
  delete files['./styles/Frames.auwla'];
  expect((await project.update(['./styles/Frames.auwla'])).build.ok).toBe(false);
  files['./styles/Frames.auwla'] = updated;
  expect((await project.update(['./styles/Frames.auwla'])).build.ok).toBe(true);

  const leaf = '<style id="card-frame">.card{padding:4px}</style>';
  files['./styles/Frames.auwla'] = leaf;
  await project.update(['./styles/Frames.auwla']);
  // App still uses Palette's global reset, so remove that use too before pruning.
  files['./App.auwla'] = files['./App.auwla']!.replace('@use("./styles/Palette.auwla", "page-reset");', '');
  const pruned = await project.update(['./App.auwla']);
  expect(pruned.build.ok).toBe(true);
  expect(pruned.build.modules).not.toContain('./styles/Palette.auwla');
});

it('rebases native resource tokens while preserving literals and nonrelative URLs', () => {
  const css = String.raw`@import "./reset.css" layer(reset);
  @font-face {font-family:Demo;src:url(../fonts/demo.woff2?v=1#font)}
  .card {background:image-set(url("icons/a b.svg") 1x,url(data:image/svg+xml,abc) 2x);
    --literal:fn(@import "keep.css");content:"url(./literal.svg)";
    mask:url(#mask);background-image:url(/root.svg),url(https://example.test/a.svg);}`;
  const result = rebaseStyleUrls(css, './shared/theme/Look.auwla', './ui/Panel.auwla');
  expect(result).toContain('@import "../shared/theme/reset.css"');
  expect(result).toContain('url("../shared/fonts/demo.woff2?v=1#font")');
  expect(result).toContain('url("../shared/theme/icons/a b.svg")');
  expect(result).toContain('fn(@import "keep.css")');
  expect(result).toContain('content:"url(./literal.svg)"');
  expect(result).toContain('url(#mask)');
  expect(result).toContain('url(/root.svg),url(https://example.test/a.svg)');
  expect(rebaseStyleUrls(String.raw`.a{background:url("icons/\64 ot.svg")}`, './shared/Look.auwla', './ui/Panel.auwla'))
    .toContain('url("../shared/icons/dot.svg")');
  expect(rebaseStyleUrls(css, './ui/A.auwla', './ui/B.auwla')).toBe(css);
});

it('bundles and executes the real gallery without loading or running definition JavaScript', async () => {
  const copy = mkdtempSync(resolve(import.meta.dir, '../.style-reuse-'));
  copies.push(copy);
  cpSync(root, copy, { recursive: true });
  const palette = join(copy, 'styles/Palette.auwla');
  writeFileSync(palette, readFileSync(palette, 'utf8') + '\nimport "./must-not-load.ts";\nthrow new Error("STYLE_DEFINITION_MUST_NOT_EXECUTE");');
  const result = await Bun.build({
    entrypoints: [join(copy, 'main.ts')], target: 'browser', external: ['@memoized-dom/*'],
    plugins: [memoizedDom({ root: copy, client: './main.ts', languages: [auwla] })],
  });
  expect(result.success).toBe(true);
  const css = await result.outputs.find((output) => output.path.endsWith('.css'))!.text();
  expect(css).toContain('--scope-reset');
  expect(css).toContain('data:image/svg+xml');
  const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
  expect(code).not.toContain('STYLE_DEFINITION_MUST_NOT_EXECUTE');
  expect(code).not.toContain('must-not-load');
  const module = toModuleFunction(code);
  const exports: Record<string, unknown> = {};
  const container = document.createElement('div');
  container.id = 'app';
  document.body.append(container);
  runtime.setScheduler((run) => run());
  new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
    module.specifiers.map(() => runtime), exports, () => {},
    ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
  );
  applications.push(exports.application as runtime.MountedApplication);
  expect(container.querySelector('[data-card="teal"] .title')!.textContent).toBe('Teal card');
  container.querySelector<HTMLButtonElement>('[data-card="teal"] button')!.click();
  expect(container.querySelector('[data-card="teal"] .status')!.textContent).toBe('Expanded: true');
});

it('keeps native CSS assistance usable while cross-file source resolution is deferred', () => {
  const session = createCssSession(sources['./Cards.auwla']!, 'file:///Cards.auwla')!;
  expect(session.diagnostics()).toEqual([]);
  expect(session.hover(sources['./Cards.auwla']!.indexOf('border-color'))).toBeTruthy();
});
