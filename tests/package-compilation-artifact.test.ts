import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  analyzeServerFunctionModule,
  compileModulesDetailed,
  experimentalCompilePackage,
  generateServerFunctionClient,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { unregister } from '@memoized-dom/runtime';
import { waitFor } from '../test-support/helpers';
import { utilsPackageArtifact } from '../test-support/package-artifacts';

const outDir = join(
  import.meta.dirname,
  'fixtures',
  'out',
  'package-compilation-artifact',
);

describe('experimental package compilation artifacts', () => {
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

  it('rejects consumer-dependent component and state exports', () => {
    expect(() => experimentalCompilePackage({
      './index.tsx': `
        export let count = 0;
        export function Badge({ value }) {
          return <b>{value}</b>;
        }
      `,
    }, {
      packageEntries: { 'some-components': './index.tsx' },
    })).toThrow('component and state package linking is not implemented');
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
});
