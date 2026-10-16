import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { unregister } from '@memoized-dom/runtime';
import { waitFor } from '../test-support/helpers';

const outDir = join(
  import.meta.dirname,
  'fixtures',
  'out',
  'request-state-helper-linking',
);

describe('request-state helper linking', () => {
  it('carries request-holder reads through imports and re-exports', () => {
    const { metadata, output } = compileModulesDetailed({
      './helper.ts': `
        import { $track } from '@memoized-dom/data';
        export function busy(source) {
          return $track(source).pending;
        }
      `,
      './bridge.ts': `
        import { busy } from './helper';
        export function waitingFor(source) {
          return busy(source);
        }
      `,
      './app.tsx': `
        import { waitingFor as waiting } from './bridge';
        export function App() {
          const stories = $fetch('/api/stories');
          const pending = waiting(stories);
          return <button disabled={pending}>Continue</button>;
        }
      `,
    });

    expect(metadata['./helper.ts']!.functionExports).toContainEqual(
      expect.objectContaining({
        exported: 'busy',
        parameterSourceReads: [{ index: 0, path: [] }],
      }),
    );
    expect(metadata['./bridge.ts']!.functionExports).toContainEqual(
      expect.objectContaining({
        exported: 'waitingFor',
        parameterSourceReads: [{ index: 0, path: [] }],
      }),
    );

    const app = output['./app.tsx']!;
    expect(app).toContain('waiting(stories)');
    expect(app).not.toMatch(/deriveResolvedValues\(\[stories\].*waiting/s);
  });

  it('does not payload-gate direct request-state projections', () => {
    const { output } = compileModulesDetailed({
      './app.tsx': `
        import { $track } from '@memoized-dom/data';
        export function App() {
          const stories = $fetch('/api/stories');
          const pending = $track(stories).pending;
          return <button disabled={pending}>Continue</button>;
        }
      `,
    });

    const app = output['./app.tsx']!;
    expect(app).toContain('$track(stories).pending');
    expect(app).not.toMatch(/deriveResolvedValues\(\[stories\].*\$track/s);
  });

  it('maps request-state reads through argument property paths', () => {
    const { metadata, output } = compileModulesDetailed({
      './helper.ts': `
        import { $track } from '@memoized-dom/data';
        export function busy(options) {
          return $track(options.source).pending;
        }
      `,
      './app.tsx': `
        import { busy } from './helper';
        export function App() {
          const stories = $fetch('/api/stories');
          const waiting = busy({ source: stories });
          return <span>{waiting ? 'Loading' : 'Ready'}</span>;
        }
      `,
    });

    expect(metadata['./helper.ts']!.functionExports).toContainEqual(
      expect.objectContaining({
        exported: 'busy',
        parameterSourceReads: [{ index: 0, path: ['source'] }],
      }),
    );
    expect(output['./app.tsx']).toContain("busy({ source: stories })");
    expect(output['./app.tsx']).not.toMatch(
      /deriveResolvedValues\(\[stories\].*busy/s,
    );
  });

  it('applies the same analysis to local helpers without name special cases', () => {
    const { output } = compileModulesDetailed({
      './app.tsx': `
        import { $track } from '@memoized-dom/data';
        function requestIsPending(value) {
          return $track(value).pending;
        }
        export function App() {
          const stories = $fetch('/api/stories');
          const pending = requestIsPending(stories);
          return <span>{pending ? 'Loading' : 'Ready'}</span>;
        }
      `,
    });

    const app = output['./app.tsx']!;
    expect(app).toContain('requestIsPending(stories)');
    expect(app).not.toMatch(
      /deriveResolvedValues\(\[stories\].*requestIsPending/s,
    );
  });

  it('updates an imported request-state projection without replacing its DOM', async () => {
    const { output } = compileModulesDetailed({
      './helper.ts': `
        import { $track } from '@memoized-dom/data';
        export function pending(source) {
          return $track(source).pending;
        }
      `,
      './app.tsx': `
        import { pending as isPending } from './helper';
        export function App() {
          const stories = $fetch('/api/stories');
          const waiting = isPending(stories);
          return <button disabled={waiting}>{waiting ? 'Loading' : 'Ready'}</button>;
        }
      `,
    }, { runtimePath: '@memoized-dom/runtime/testing' });
    mkdirSync(outDir, { recursive: true });
    for (const [file, code] of Object.entries(output)) {
      writeFileSync(
        join(outDir, file.slice(2).replace(/\.tsx$/, '.ts')),
        code,
      );
    }

    const request = Promise.withResolvers<Response>();
    const data = createDataRuntime({ fetch: () => request.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { App } = await import(
        `${pathToFileURL(join(outDir, 'app.ts')).href}?runtime=${Date.now()}`
      );
      const button = App('RequestStateHelper', null) as HTMLButtonElement;
      document.body.append(button);
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe('Loading');

      request.resolve(Response.json([{ id: 1 }]));
      await waitFor(() => {
        expect(button.disabled).toBe(false);
        expect(button.textContent).toBe('Ready');
      });
      expect(document.querySelector('button')).toBe(button);
    } finally {
      unregister('RequestStateHelper');
      data.clear();
      setActiveDataRuntime(previous);
      document.body.replaceChildren();
    }
  });
});
