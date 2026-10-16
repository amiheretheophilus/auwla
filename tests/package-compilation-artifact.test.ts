import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compileModulesDetailed,
  experimentalCompilePackage,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { unregister } from '@memoized-dom/runtime';
import { waitFor } from '../test-support/helpers';

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
});
