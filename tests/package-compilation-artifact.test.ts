import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  analyzeServerFunctionModule,
  compileModulesDetailed,
  definePackageBoundaries,
  experimentalCompilePackage,
  generateServerFunctionClient,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { registerRootFactory, unregister } from '@memoized-dom/runtime';
import { renderToString } from '@memoized-dom/server';
import { waitFor } from '../test-support/helpers';
import { utilsPackageArtifact } from '../test-support/package-artifacts';

const outDir = join(
  import.meta.dirname,
  'fixtures',
  'out',
  'package-compilation-artifact',
);

describe('experimental package compilation artifacts', () => {
  it('builds opaque runtime-boundary artifacts from the compact authoring form', () => {
    expect(definePackageBoundaries({
      'runtime-package/internal': {
        holdSource: {
          source: [0, { argument: 1, path: ['nested'] }],
          writes: [{ argument: 2, path: ['value'] }],
        },
      },
    })).toEqual({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'runtime-package/internal': {
          functions: {
            holdSource: {
              parameterWrites: [{ index: 2, path: ['value'] }],
              parameterSourceReads: [
                { index: 0, path: [] },
                { index: 1, path: ['nested'] },
              ],
              parameterPayloadReads: [],
              unbounded: false,
            },
          },
        },
      },
    });
    expect(() => definePackageBoundaries({
      bad: { helper: { source: [-1] } },
    })).toThrow('must be a non-negative integer');
  });

  it('links a separately compiled ordinary helper without its source', async () => {
    const packaged = experimentalCompilePackage({
      './index.ts': `
        import { $track } from '@memoized-dom/data';
        export function describe(source) {
          return $track(source).pending
            ? 'Loading'
            : source.length + ' stories';
        }
      `,
    }, {
      packageEntries: { 'some-package': './index.ts' },
      runtimePath: '@memoized-dom/runtime/testing',
    });

    expect(packaged.artifact).toEqual({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'some-package': {
          functions: {
            describe: expect.objectContaining({
              parameterSourceReads: [{ index: 0, path: [] }],
              parameterPayloadReads: [{ index: 0, path: [] }],
            }),
          },
        },
      },
    });
    expect(packaged.output['./index.ts']).toContain('_MDD.readResolvedValue(source');
    const storedArtifact = JSON.parse(
      JSON.stringify(packaged.artifact),
    ) as ExperimentalPackageArtifact;

    const application = compileModulesDetailed({
      './app.tsx': `
        import { describe as label } from 'some-package';
        export function PackageApp() {
          const stories = $fetch('/api/package-stories');
          return <p>{label(stories)}</p>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [storedArtifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    mkdirSync(join(outDir, 'node_modules', 'some-package'), { recursive: true });
    writeFileSync(
      join(outDir, 'node_modules', 'some-package', 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(
      join(outDir, 'node_modules', 'some-package', 'index.js'),
      packaged.output['./index.ts']!,
    );
    writeFileSync(join(outDir, 'app.js'), application.output['./app.tsx']!);

    const request = Promise.withResolvers<Response>();
    const data = createDataRuntime({ fetch: () => request.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { PackageApp } = await import(
        `${pathToFileURL(join(outDir, 'app.js')).href}?runtime=${Date.now()}`
      );
      const paragraph = PackageApp('PackageArtifactApp', null) as HTMLParagraphElement;
      document.body.append(paragraph);
      expect(paragraph.textContent).toBe('Loading');

      request.resolve(Response.json([{ id: 1 }, { id: 2 }]));
      await waitFor(() => {
        expect(paragraph.textContent).toBe('2 stories');
      });
      expect(document.querySelector('p')).toBe(paragraph);
    } finally {
      unregister('PackageArtifactApp');
      data.clear();
      setActiveDataRuntime(previous);
      document.body.replaceChildren();
    }
  });

  it('rejects package-owned compiler state', () => {
    expect(() => experimentalCompilePackage({
      './index.tsx': `
        export let count = 0;
        export function increment() {
          return ++count;
        }
      `,
    }, {
      packageEntries: { 'some-components': './index.tsx' },
    })).toThrow('package state linking is not implemented');
  });

  it('rejects precompiled components which read package module state', () => {
    expect(() => experimentalCompilePackage({
      './index.tsx': `
        let count = 0;
        export function Counter() {
          return <button onClick={() => count++}>{count}</button>;
        }
      `,
    }, {
      packageEntries: { 'some-components': './index.tsx' },
    })).toThrow('components read package module state');
  });

  it('rejects package component identities not owned by their entry', () => {
    const artifact = structuredClone(experimentalCompilePackage({
      './index.tsx': `export function Badge() { return <b>Badge</b>; }`,
    }, {
      packageEntries: { 'bad-package': './index.tsx' },
    }).artifact);
    const badge = artifact.entries['bad-package']!.components!.Badge!;
    (badge as { key: string }).key = './app.tsx#App';
    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { Badge } from 'bad-package';
        export function App() { return <Badge />; }
      `,
    }, {
      experimentalPackageArtifacts: [artifact],
    })).toThrow("component 'bad-package' export 'Badge' has invalid key");
  });

  it('rejects a packaged component which claims the caller-only row ABI', () => {
    const artifact = structuredClone(experimentalCompilePackage({
      './index.tsx': `export function Row() { return <li>Row</li>; }`,
    }, {
      packageEntries: { 'bad-row-package': './index.tsx' },
    }).artifact);
    const row = artifact.entries['bad-row-package']!.components!.Row!;
    (row as { listLightweight: boolean }).listLightweight = true;

    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { Row } from 'bad-row-package';
        export function App() { return <ul><Row /></ul>; }
      `,
    }, {
      experimentalPackageArtifacts: [artifact],
    })).toThrow("advertises an unsupported lightweight row ABI");
  });

  it('compiles the real request-state utilities without utility-name handling', async () => {
    const utilitySource = readFileSync(
      join(import.meta.dirname, '..', 'packages', 'utils', 'src', 'request-state.ts'),
      'utf8',
    );
    const packaged = experimentalCompilePackage({
      './request-state.ts': utilitySource,
    }, {
      packageEntries: { 'track-utils': './request-state.ts' },
      runtimePath: '@memoized-dom/runtime/testing',
    });
    expect(
      packaged.artifact.entries['track-utils']!.functions.pending,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: [] }],
      parameterPayloadReads: [],
    });
    expect(
      packaged.artifact.entries['track-utils']!.functions.status,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: [] }],
      parameterPayloadReads: [],
    });

    const application = compileModulesDetailed({
      './utils-app.tsx': `
        import { pending, status } from 'track-utils';
        export function UtilsApp() {
          const stories = $fetch('/api/utils-stories');
          const waiting = pending(stories);
          return <p>{waiting
            ? 'Loading'
            : status(stories) + ':' + stories.length}</p>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'track-utils');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(
      join(packageDir, 'index.js'),
      packaged.output['./request-state.ts']!,
    );
    writeFileSync(
      join(outDir, 'utils-app.js'),
      application.output['./utils-app.tsx']!,
    );

    const request = Promise.withResolvers<Response>();
    const data = createDataRuntime({ fetch: () => request.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { UtilsApp } = await import(
        `${pathToFileURL(join(outDir, 'utils-app.js')).href}?runtime=${Date.now()}`
      );
      const paragraph = UtilsApp('PackageTrackUtilsApp', null) as HTMLParagraphElement;
      document.body.append(paragraph);
      expect(paragraph.textContent).toBe('Loading');

      request.resolve(Response.json([{ id: 1 }]));
      await waitFor(() => {
        expect(paragraph.textContent).toBe('success:1');
      });
      expect(document.querySelector('p')).toBe(paragraph);
    } finally {
      unregister('PackageTrackUtilsApp');
      data.clear();
      setActiveDataRuntime(previous);
      document.body.replaceChildren();
    }
  });

  it('links optimistic source holders through package metadata without compiler name handling', () => {
    expect(
      utilsPackageArtifact.entries['@memoized-dom/utils']!.functions.optimistic,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: ['source'] }],
    });

    const application = compileModulesDetailed({
      './app.tsx': `
        import { optimistic as mutate } from '@memoized-dom/utils';
        export function App() {
          const first = $fetch('/first');
          const second = $fetch('/second');
          const save = mutate({
            source: [first, second],
            action: () => Promise.resolve(1),
            apply: () => () => {},
          });
          return <button onClick={() => save()}>Save</button>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [utilsPackageArtifact],
    });

    const output = application.output['./app.tsx']!;
    expect(output).toContain('source: [first, second]');
    expect(output).not.toMatch(
      /source: \[(?:_MDD\.)?(?:readResolvedValue|readModuleSource)/,
    );
  });

  it('composes request-state relationships through package re-exports', () => {
    const packaged = experimentalCompilePackage({
      './pending.ts': `
        import { $track } from '@memoized-dom/data';
        export function pending(source) {
          return $track(source).pending;
        }
      `,
      './index.ts': `
        import { pending } from './pending';
        export function waitingFor(source) {
          return pending(source);
        }
      `,
    }, {
      packageEntries: { 'status-package': './index.ts' },
    });

    expect(
      packaged.artifact.entries['status-package']!.functions.waitingFor,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: [] }],
      parameterPayloadReads: [],
    });

    const application = compileModulesDetailed({
      './app.tsx': `
        import { waitingFor as pending } from 'status-package';
        export function App() {
          const stories = $fetch('/stories');
          return <p>{pending(stories) ? 'Loading' : 'Ready'}</p>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
    });

    expect(application.output['./app.tsx']).toContain('pending(stories)');
    expect(application.output['./app.tsx']).not.toMatch(
      /deriveResolvedValues\(\[stories\].*pending/s,
    );
  });

  it('preserves an event-created request holder through a packaged projection', () => {
    const functions = generateServerFunctionClient(analyzeServerFunctionModule(`
      export const postVote = define.function({
        post: async (_context, id: number) => ({ id }),
      });
    `, { moduleId: '/app/server/functions/votes.ts' }));
    const application = compileModulesDetailed({
      './app.tsx': `
        import { pending } from '@memoized-dom/utils';
        import { postVote } from './functions';
        export function App() {
          let lastVote: ReturnType<typeof postVote> | null = null;
          return <main>
            <button onClick={() => { lastVote = postVote(1); }}>Vote</button>
            {lastVote !== null && <p>{pending(lastVote) ? 'Voting' : 'Saved'}</p>}
          </main>;
        }
      `,
      './functions.ts': functions,
    }, {
      experimentalPackageArtifacts: [utilsPackageArtifact],
    });

    const output = application.output['./app.tsx']!;
    expect(output).toContain('createEventSourceSlot()');
    expect(output).toContain('pending(lastVote)');
    expect(output).not.toMatch(
      /deriveResolvedValues\(\[lastVote\].*pending/s,
    );
  });

  it('links precompiled prop, local-state, and slot components', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function Badge({ value }: { value: number }) {
          let local = 0;
          return <button data-badge onClick={() => local++}>{value}:{local}</button>;
        }

        export function Panel() {
          return <section data-panel><slot><i>Fallback</i></slot></section>;
        }

        export function ForwardInput({ ref }: { ref: (node: HTMLInputElement) => void }) {
          return <input data-forwarded ref={ref} />;
        }
      `,
    }, {
      packageEntries: { 'ui-package': './index.tsx' },
      runtimePath: '@memoized-dom/runtime/testing',
    });

    expect(packaged.artifact.entries['ui-package']!.components).toMatchObject({
      Badge: {
        props: ['value'],
        renderProps: [],
        slots: [],
      },
      Panel: {
        slots: [''],
      },
      ForwardInput: {
        refProps: ['ref'],
      },
    });

    const application = compileModulesDetailed({
      './component-app.tsx': `
        import { Badge, ForwardInput, Panel } from 'ui-package';
        export function ComponentApp() {
          let value = 1;
          return <main>
            <Badge value={value} />
            <button data-parent onClick={() => value++}>Parent</button>
            <Panel><strong>Projected</strong></Panel>
            <ForwardInput ref={node => { globalThis.__packagedRef = node; }} />
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'ui-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'component-app.js'),
      application.output['./component-app.tsx']!,
    );

    document.body.replaceChildren();
    try {
      const { ComponentApp } = await import(
        `${pathToFileURL(join(outDir, 'component-app.js')).href}?runtime=${Date.now()}`
      );
      const main = ComponentApp('PackageComponentApp', null) as HTMLElement;
      document.body.append(main);
      const badge = main.querySelector<HTMLButtonElement>('[data-badge]')!;
      const parent = main.querySelector<HTMLButtonElement>('[data-parent]')!;
      expect(badge.textContent).toBe('1:0');
      expect(main.querySelector('[data-panel]')?.textContent).toBe('Projected');
      await waitFor(() => {
        expect((globalThis as Record<string, unknown>).__packagedRef).toBe(
          main.querySelector('[data-forwarded]'),
        );
      }, 5_000);

      badge.click();
      await waitFor(() => {
        expect(badge.textContent).toBe('1:1');
      });
      parent.click();
      await waitFor(() => {
        expect(badge.textContent).toBe('2:1');
      });
      expect(main.querySelector<HTMLButtonElement>('[data-badge]')).toBe(badge);
    } finally {
      unregister('PackageComponentApp');
      delete (globalThis as Record<string, unknown>).__packagedRef;
      document.body.replaceChildren();
    }
  });

  it('keeps packaged scalar and render-prop modes exact', () => {
    const renderPackage = experimentalCompilePackage({
      './index.tsx': `
        export function RenderValue({ value }) {
          return <b>{value}</b>;
        }
      `,
    }, {
      packageEntries: { 'render-package': './index.tsx' },
    });
    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { RenderValue } from 'render-package';
        export function App() { return <RenderValue value={1} />; }
      `,
    }, {
      experimentalPackageArtifacts: [renderPackage.artifact],
    })).toThrow("render prop 'value' on <RenderValue> must be JSX");

    const scalarPackage = experimentalCompilePackage({
      './index.tsx': `
        export function ScalarValue({ value }: { value: number }) {
          return <b>{value}</b>;
        }
      `,
    }, {
      packageEntries: { 'scalar-package': './index.tsx' },
    });
    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { ScalarValue } from 'scalar-package';
        export function App() {
          return <ScalarValue value={<i>Wrong mode</i>} />;
        }
      `,
    }, {
      experimentalPackageArtifacts: [scalarPackage.artifact],
    })).toThrow("JSX prop 'value' on <ScalarValue> is not rendered by the callee");
  });

  it('renders a precompiled package component during SSR', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function ServerCard({ value }: { value: number }) {
          return <article data-server-card>Server value: {value}</article>;
        }
      `,
    }, {
      packageEntries: { 'ui-server-package': './index.tsx' },
    });
    const application = compileModulesDetailed({
      './server-component-app.tsx': `
        import { ServerCard } from 'ui-server-package';
        export function ServerComponentApp() {
          return <main><ServerCard value={7} /></main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      routedEnvironment: 'server',
      moduleStateCells: true,
    });

    const packageDir = join(outDir, 'node_modules', 'ui-server-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'server-component-app.js'),
      application.output['./server-component-app.tsx']!,
    );
    const { ServerComponentApp } = await import(
      `${pathToFileURL(join(outDir, 'server-component-app.js')).href}?runtime=${Date.now()}`
    );
    registerRootFactory(ServerComponentApp, {
      id: 'PackageServerComponentApp',
      create: () => ServerComponentApp('PackageServerComponentApp', null),
    });
    try {
      expect(renderToString(ServerComponentApp)).toContain(
        '<article data-server-card="true">Server value: 7</article>',
      );
    } finally {
      unregister('PackageServerComponentApp');
    }
  });

  it('uses the ordinary component ABI when an app maps a packaged row', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        interface Item { id: number; label: string }
        export function ItemRow({ item }: { item: Item }) {
          return <li data-row={item.id}>{item.label}</li>;
        }
      `,
    }, {
      packageEntries: { 'ui-row-package': './index.tsx' },
      runtimePath: '@memoized-dom/runtime/testing',
    });
    expect(
      packaged.artifact.entries['ui-row-package']!.components!.ItemRow,
    ).toMatchObject({ listLightweight: false });

    const application = compileModulesDetailed({
      './row-component-app.tsx': `
        import { ItemRow } from 'ui-row-package';
        export function RowComponentApp() {
          let items = [{ id: 1, label: 'One' }];
          return <main>
            <ul>{items.map(item => <ItemRow key={item.id} item={item} />)}</ul>
            <button data-add onClick={() => items.push({ id: 2, label: 'Two' })}>Add</button>
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'ui-row-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'row-component-app.js'),
      application.output['./row-component-app.tsx']!,
    );

    document.body.replaceChildren();
    try {
      const { RowComponentApp } = await import(
        `${pathToFileURL(join(outDir, 'row-component-app.js')).href}?runtime=${Date.now()}`
      );
      const main = RowComponentApp('PackageRowComponentApp', null) as HTMLElement;
      document.body.append(main);
      const first = main.querySelector<HTMLLIElement>('[data-row="1"]')!;
      expect(first.textContent).toBe('One');

      main.querySelector<HTMLButtonElement>('[data-add]')!.click();
      await waitFor(() => {
        expect(main.querySelectorAll('li')).toHaveLength(2);
      });
      expect(main.querySelector<HTMLLIElement>('[data-row="1"]')).toBe(first);
      expect(main.querySelector<HTMLLIElement>('[data-row="2"]')?.textContent).toBe('Two');
    } finally {
      unregister('PackageRowComponentApp');
      document.body.replaceChildren();
    }
  });

  it('updates a keyed list through nested precompiled package components', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        interface Item { id: number; label: string }
        export function ItemRow({ item }: { item: Item }) {
          return <li data-row={item.id}>{item.label}</li>;
        }
        export function ItemList({ items }: { items: Item[] }) {
          return <ul>{items.map(item => <ItemRow key={item.id} item={item} />)}</ul>;
        }
      `,
    }, {
      packageEntries: { 'ui-list-package': './index.tsx' },
      runtimePath: '@memoized-dom/runtime/testing',
    });
    const application = compileModulesDetailed({
      './list-component-app.tsx': `
        import { ItemList } from 'ui-list-package';
        export function ListComponentApp() {
          let items = [{ id: 1, label: 'One' }];
          return <main>
            <ItemList items={items} />
            <button data-add onClick={() => items.push({ id: 2, label: 'Two' })}>Add</button>
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'ui-list-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'list-component-app.js'),
      application.output['./list-component-app.tsx']!,
    );

    document.body.replaceChildren();
    try {
      const { ListComponentApp } = await import(
        `${pathToFileURL(join(outDir, 'list-component-app.js')).href}?runtime=${Date.now()}`
      );
      const main = ListComponentApp('PackageListComponentApp', null) as HTMLElement;
      document.body.append(main);
      const first = main.querySelector<HTMLLIElement>('[data-row="1"]')!;
      expect(first.textContent).toBe('One');

      main.querySelector<HTMLButtonElement>('[data-add]')!.click();
      await waitFor(() => {
        expect(main.querySelectorAll('li')).toHaveLength(2);
      });
      expect(main.querySelector<HTMLLIElement>('[data-row="1"]')).toBe(first);
      expect(main.querySelector<HTMLLIElement>('[data-row="2"]')?.textContent).toBe('Two');
    } finally {
      unregister('PackageListComponentApp');
      document.body.replaceChildren();
    }
  });
});
