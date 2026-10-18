import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { experimentalCompilePackage, memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow } from '@memoized-dom/compiler';
import { compileGraph, type GraphPluginContext } from '../src/graph/collector';
import { resolveAdapterOptions } from '../src/options';
import { discoverPackageArtifact, packageArtifactSource } from '../src/graph/package-artifacts';
import { valueImports } from '../src/graph/imports';

describe('package compilation artifacts', () => {
  it('follows exact optimized entry origins instead of guessing from package names', () => {
    const metadata = { depInfoList: [
      { id: 'library', file: '/cache/library.js', src: '/first/node_modules/library/dist/index.js' },
      { id: 'library-copy', file: '/cache/library-copy.js', src: '/second/node_modules/library/dist/index.js' },
      { id: 'chunk', file: '/cache/chunk.js' },
    ] };
    expect(packageArtifactSource('/cache/library.js?v=123', metadata)).toBe('/first/node_modules/library/dist/index.js');
    expect(packageArtifactSource('/cache/library-copy.js?v=456', metadata)).toBe('/second/node_modules/library/dist/index.js');
    expect(packageArtifactSource('/cache/chunk.js?v=789', metadata)).toBe('/cache/chunk.js?v=789');
    expect(packageArtifactSource('/other/library.js', metadata)).toBe('/other/library.js');
  });

  it('collects named value re-exports while leaving type-only dependencies out', () => {
    const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend,
      `export {make,type Options} from 'library';export type {Other} from 'types-only';
       export {privateValue} from '#server/private';`, { filename: './barrel.ts', sourceType: 'module' }).program;
    expect(valueImports(program).map(reference => reference.specifier)).toEqual(['library', '#server/private']);
  });

  it('discovers import-only external SSR entries whose manifest is hidden by exports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-import-only-artifact-'));
    const directory = join(root, 'node_modules/import-only');
    mkdirSync(directory, { recursive: true });
    const compiled = experimentalCompilePackage({ './index.ts': 'export function identity(value:number){return value;}' },
      { packageEntries: { 'import-only': './index.ts' } });
    writeFileSync(join(directory, 'index.js'), compiled.output['./index.ts']!);
    writeFileSync(join(directory, 'artifact.json'), JSON.stringify(compiled.artifact));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'import-only', type: 'module',
      exports: { '.': { import: './index.js' } }, 'memoized-dom': { artifact: './artifact.json' } }));
    try {
      const found = await discoverPackageArtifact('import-only', 'import-only', join(root, 'App.tsx'));
      expect(found?.artifact.entries['import-only']?.functions.identity).toBeDefined();
      expect(await discoverPackageArtifact('another-external-id', 'import-only', join(root, 'App.tsx'))).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('discovers generated host adoption contracts for reactive initial HTML', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-package-adoption-'));
    const entry = join(root, 'main.ts');
    const component = join(root, 'App.tsx');
    const packageRoot = join(root, 'node_modules', 'adopted-ui');
    const packageEntry = join(packageRoot, 'index.js');
    mkdirSync(packageRoot, { recursive: true });
    const packaged = experimentalCompilePackage({
      './index.tsx': `export function Badge({label}:{label:string}) { return <strong>{label}</strong>; }`,
    }, { packageEntries: { 'adopted-ui': './index.tsx' } });
    writeFileSync(packageEntry, packaged.output['./index.tsx']!);
    writeFileSync(join(packageRoot, 'memoized-dom.package.json'), JSON.stringify(packaged.artifact));
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'adopted-ui', type: 'module', exports: './index.js',
      'memoized-dom': { artifact: './memoized-dom.package.json' },
    }));
    writeFileSync(entry, `import {mount} from '@memoized-dom/runtime'; import {App} from './App'; mount('root', App);`);
    writeFileSync(component, `import {Badge} from 'adopted-ui'; export function App() {
      let label='Before'; return <main><Badge label={label}/><button onClick={()=>label='After'}>Change</button></main>;
    }`);
    const context: GraphPluginContext = {
      async resolve(specifier) {
        if (specifier === './App') return { id: component };
        if (specifier === 'adopted-ui') return { id: packageEntry };
        if (specifier === '@memoized-dom/runtime') return { id: resolve(import.meta.dirname, '../../runtime/src/index.ts') };
        return null;
      },
      addWatchFile() {},
      error(error): never { throw new Error(error.message); },
    };
    try {
      const graph = await compileGraph(context, root, [entry],
        resolveAdapterOptions({ clientEntry: entry }), new Map(), false, true, [], 'client', [{
          filename: join(root, 'index.html'),
          html: '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.ts"></script></body></html>',
        }]);
      expect(graph.files).toEqual(new Set([entry, component].map(file => file.replaceAll('\\', '/'))));
      expect(graph.initialPage?.html).toContain('<strong>Before</strong>');
      expect(graph.initialPage?.interactive).toBe(true);
      expect(graph.initialDelivery?.browser).toBe('bindings');
      expect(graph.output.get(component.replaceAll('\\', '/'))).toMatch(/Badge\([^;]+_initialNodes\[/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers package metadata and links it without compiling package source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-package-artifact-'));
    const entry = join(root, 'App.tsx');
    const packageRoot = join(root, 'node_modules', 'track-utils');
    const packageEntry = join(packageRoot, 'index.js');
    const artifactFile = join(packageRoot, 'memoized-dom.package.json');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(entry, `
      import { pending } from 'track-utils';
      export function App() {
        const stories = $fetch('/stories');
        const waiting = pending(stories);
        return <p>{waiting ? 'Loading' : stories.length + ' stories'}</p>;
      }
    `);
    writeFileSync(packageEntry, `
      export function pending(source) { return source.pending; }
    `);
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'track-utils',
      type: 'module',
      exports: './index.js',
      'memoized-dom': { artifact: './memoized-dom.package.json' },
    }));
    writeFileSync(artifactFile, JSON.stringify({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'track-utils': {
          functions: {
            pending: {
              parameterWrites: [],
              parameterSourceReads: [{ index: 0, path: [] }],
              parameterPayloadReads: [],
              unbounded: false,
            },
          },
        },
      },
    }));

    const watched = new Set<string>();
    const context: GraphPluginContext = {
      async resolve(specifier) {
        return specifier === 'track-utils' ? { id: packageEntry } : null;
      },
      addWatchFile(file) { watched.add(file); },
      error(error): never { throw new Error(error.message); },
    };
    try {
      const graph = await compileGraph(
        context,
        root,
        [entry],
        resolveAdapterOptions({ clientEntry: entry }),
        new Map(),
        false,
        false,
      );
      expect(graph.files).toEqual(new Set([entry.replaceAll('\\', '/')]));
      expect(watched).toContain(join(packageRoot, 'package.json').replaceAll('\\', '/'));
      expect(watched).toContain(artifactFile.replaceAll('\\', '/'));
      expect(graph.output.get(entry.replaceAll('\\', '/'))).toContain(
        '_MDD.connectResolvedValues([stories]',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an artifact path which escapes the package directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-package-artifact-escape-'));
    const packageRoot = join(root, 'node_modules', 'track-utils');
    const packageEntry = join(packageRoot, 'index.js');
    const importer = join(root, 'App.tsx');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(importer, `import { pending } from 'track-utils';`);
    writeFileSync(packageEntry, 'export function pending() {}');
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'track-utils',
      type: 'module',
      exports: './index.js',
      'memoized-dom': { artifact: '../shared-artifact.json' },
    }));

    const context: GraphPluginContext = {
      async resolve(specifier) {
        return specifier === 'track-utils' ? { id: packageEntry } : null;
      },
      addWatchFile() {},
      error(error): never { throw new Error(error.message); },
    };
    try {
      await expect(compileGraph(
        context,
        root,
        [importer],
        resolveAdapterOptions({ clientEntry: importer }),
        new Map(),
        false,
        false,
      )).rejects.toThrow('outside its package directory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports the exact malformed field in a discovered artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-package-artifact-invalid-'));
    const packageRoot = join(root, 'node_modules', 'track-utils');
    const packageEntry = join(packageRoot, 'index.js');
    const importer = join(root, 'App.tsx');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(importer, `import { pending } from 'track-utils'; pending(null);`);
    writeFileSync(packageEntry, 'export function pending() {}');
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'track-utils',
      type: 'module',
      exports: './index.js',
      'memoized-dom': { artifact: './memoized-dom.package.json' },
    }));
    writeFileSync(join(packageRoot, 'memoized-dom.package.json'), JSON.stringify({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'track-utils': {
          functions: {
            pending: {
              parameterWrites: [],
              parameterSourceReads: 'argument zero',
              parameterPayloadReads: [],
              unbounded: false,
            },
          },
        },
      },
    }));

    const context: GraphPluginContext = {
      async resolve(specifier) {
        return specifier === 'track-utils' ? { id: packageEntry } : null;
      },
      addWatchFile() {},
      error(error): never { throw new Error(error.message); },
    };
    try {
      await expect(compileGraph(
        context,
        root,
        [importer],
        resolveAdapterOptions({ clientEntry: importer }),
        new Map(),
        false,
        false,
      )).rejects.toThrow(
        'artifact.entries["track-utils"].functions["pending"].parameterSourceReads; expected an array of argument facts',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps two importer-resolved copies of one package specifier distinct', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-package-artifact-copies-'));
    const entry = join(root, 'App.tsx');
    const first = join(root, 'First.tsx');
    const second = join(root, 'Second.tsx');
    const firstPackage = join(root, 'copies', 'first', 'ui-package');
    const secondPackage = join(root, 'copies', 'second', 'ui-package');
    const component = (props: string[]) => ({
      key: 'package:ui-package#Badge',
      props,
      objectProps: true,
      acceptsUnknownProps: false,
      hasWholeDefault: false,
      listLightweight: false,
      delegatedEvents: [],
      renderProps: [],
      slots: [],
      renderCallbacks: [],
      refProps: [],
      subtreeReads: [],
    });
    const writePackage = (directory: string, props: string[]) => {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'index.js'), 'export function Badge() {}');
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'ui-package',
        type: 'module',
        exports: './index.js',
        'memoized-dom': { artifact: './memoized-dom.package.json' },
      }));
      writeFileSync(join(directory, 'memoized-dom.package.json'), JSON.stringify({
        kind: 'memoized-dom-package',
        version: 1,
        entries: {
          'ui-package': {
            functions: {},
            components: { Badge: component(props) },
          },
        },
      }));
    };
    writeFileSync(entry, `
      import { First } from './First';
      import { Second } from './Second';
      export function App() { return <main><First /><Second /></main>; }
    `);
    writeFileSync(first, `
      import { Badge } from 'ui-package';
      export function First() { return <Badge value={1} />; }
    `);
    writeFileSync(second, `
      import { Badge } from 'ui-package';
      export function Second() { return <Badge label="two" />; }
    `);
    writePackage(firstPackage, ['value']);
    writePackage(secondPackage, ['label']);

    const context: GraphPluginContext = {
      async resolve(specifier, importer) {
        if (specifier === './First') return { id: first };
        if (specifier === './Second') return { id: second };
        if (specifier === 'ui-package') {
          return {
            id: join(
              importer.replaceAll('\\', '/') === first.replaceAll('\\', '/')
                ? firstPackage
                : secondPackage,
              'index.js',
            ),
          };
        }
        return null;
      },
      addWatchFile() {},
      error(error): never { throw new Error(error.message); },
    };
    try {
      const graph = await compileGraph(
        context,
        root,
        [entry],
        resolveAdapterOptions({ clientEntry: entry }),
        new Map(),
        false,
        false,
      );
      expect(graph.output.get(first.replaceAll('\\', '/'))).toContain('{ value: 1 }');
      expect(graph.output.get(second.replaceAll('\\', '/'))).toContain('{ label: "two" }');
      expect(graph.semanticDependencies.size).toBe(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('links a precompiled package component without admitting its source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mmd-package-component-'));
    const entry = join(root, 'App.tsx');
    const packageRoot = join(root, 'node_modules', 'ui-package');
    const packageEntry = join(packageRoot, 'index.js');
    const artifactFile = join(packageRoot, 'memoized-dom.package.json');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(entry, `
      import { Badge } from 'ui-package';
      export function App() {
        let value = 1;
        return <Badge value={value} />;
      }
    `);
    writeFileSync(packageEntry, 'export function Badge() {}');
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'ui-package',
      type: 'module',
      exports: './index.js',
      'memoized-dom': { artifact: './memoized-dom.package.json' },
    }));
    writeFileSync(artifactFile, JSON.stringify({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'ui-package': {
          functions: {},
          components: {
            Badge: {
              key: 'package:ui-package#Badge',
              props: ['value'],
              objectProps: true,
              acceptsUnknownProps: false,
              hasWholeDefault: false,
              listLightweight: false,
              delegatedEvents: [],
              renderProps: [],
              slots: [],
              renderCallbacks: [],
              refProps: [],
              subtreeReads: [],
            },
          },
        },
      },
    }));

    const context: GraphPluginContext = {
      async resolve(specifier) {
        return specifier === 'ui-package' ? { id: packageEntry } : null;
      },
      addWatchFile() {},
      error(error): never { throw new Error(error.message); },
    };
    try {
      const graph = await compileGraph(
        context,
        root,
        [entry],
        resolveAdapterOptions({ clientEntry: entry }),
        new Map(),
        false,
        false,
      );
      expect(graph.files).toEqual(new Set([entry.replaceAll('\\', '/')]));
      expect(graph.semanticDependencies).toEqual(new Set([
        join(packageRoot, 'package.json').replaceAll('\\', '/'),
        artifactFile.replaceAll('\\', '/'),
      ]));
      expect(graph.output.get(entry.replaceAll('\\', '/'))).toContain(
        'Badge(_id + "/Badge"',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
