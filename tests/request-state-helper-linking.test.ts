import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed, experimentalCompilePackage } from '@memoized-dom/compiler';
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
  it('shows state-only arms immediately and waits only for the selected payload arm', async () => {
    const { output } = compileModulesDetailed({ './lazy-sinks.tsx': `
      export function App(){const left=$fetch('/left');const right=$fetch('/right');
        const pending=$track(left).pending;
        return <section>
          <p class="conditional">{pending?'Loading':left.length?left[0].title:right[0].title}</p>
          <p class="coalesce">{pending?'Loading':left[0]?.title??right[0].title}</p>
          {pending?<b>Loading</b>:<i>{left.length?'Ready':'Empty'}</i>}
          <button onClick={()=>$track(left).refresh()}>Refresh</button>
        </section>;}`,
    }, { runtimePath: '@memoized-dom/runtime/testing' });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'lazy-sinks.ts'), output['./lazy-sinks.tsx']!);
    const first = Promise.withResolvers<Response>(), second = Promise.withResolvers<Response>();
    const unrelated = Promise.withResolvers<Response>();
    let leftCalls = 0;
    const data = createDataRuntime({ fetch: input => String(input).endsWith('/right')
      ? unrelated.promise : leftCalls++ === 0 ? first.promise : second.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { App } = await import(`${pathToFileURL(join(outDir, 'lazy-sinks.ts')).href}?runtime=${Date.now()}`);
      const root = App('LazySinks', null) as HTMLElement;
      document.body.append(root);
      expect(root.querySelector('.conditional')!.textContent).toBe('Loading');
      expect(root.querySelector('.coalesce')!.textContent).toBe('Loading');
      first.resolve(Response.json([{ title: 'Left' }]));
      await waitFor(() => expect(root.querySelector('.conditional')!.textContent).toBe('Left'));
      expect(root.querySelector('.coalesce')!.textContent).toBe('Left');
      expect(root.querySelector('i')!.textContent).toBe('Ready');
      root.querySelector('button')!.click();
      second.resolve(Response.json([]));
      await waitFor(() => expect(root.querySelector('i')!.textContent).toBe('Empty'));
      expect(root.querySelector('.conditional')!.textContent).toBe('');
      expect(root.querySelector('.coalesce')!.textContent).toBe('');
      unrelated.resolve(Response.json([{ title: 'Right' }]));
      await waitFor(() => expect(root.querySelector('.conditional')!.textContent).toBe('Right'));
      expect(root.querySelector('.coalesce')!.textContent).toBe('Right');
    } finally {
      unregister('LazySinks'); data.clear(); setActiveDataRuntime(previous); document.body.replaceChildren();
    }
  });
  it.each((['direct', 'local', 'package'] as const).flatMap(kind =>
    (['local', 'module'] as const).map(location => [kind, location] as const),
  ))('gates scalar arms for %s request-state reads over a %s source', async (kind, location) => {
    const helper = `import {$track} from '@memoized-dom/data';export function busy(source){return $track(source).refreshing;}`;
    const library = experimentalCompilePackage({ './index.ts': helper }, { packageEntries: { 'mixed-status': './index.ts' } });
    const id = `mixed-sinks-${kind}-${location}`;
    const { output } = compileModulesDetailed({
      ...(kind === 'local' ? { './helper.ts': helper } : {}),
      ...(location === 'module' ? { './sources.ts': `export const stories=$fetch('/api/${id}');` } : {}),
      [`./${id}.tsx`]: `${kind === 'direct' ? '' : `import {busy as waiting} from '${kind === 'local' ? './helper' : 'mixed-status'}';`}
        ${location === 'module' ? `import {stories} from './sources';` : ''}
        export function App(){${location === 'local' ? `const stories=$fetch('/api/${id}');` : ''}
          const refreshing=${kind === 'direct' ? '$track(stories).refreshing' : 'waiting(stories)'};
          return <section>
            <p class="conditional">{refreshing?'Refreshing':stories.length+' ready'}</p>
            <p class="nested">{refreshing?'Refreshing':stories.length?stories[0].title:'Empty'}</p>
            <p class="logical">{!refreshing&&stories.map(item=>item.title).join(',')}</p>
            <button onClick={()=>$track(stories).refresh()}>Refresh</button>
          </section>;}`,
    }, { runtimePath: '@memoized-dom/runtime/testing', experimentalPackageArtifacts: kind === 'package' ? [library.artifact] : [] });
    const directory = join(outDir, id);
    mkdirSync(directory, { recursive: true });
    const installed = join(directory, 'node_modules/mixed-status');
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'mixed-status', type: 'module', exports: './index.js' }));
    writeFileSync(join(installed, 'index.js'), library.output['./index.ts']!);
    for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file.slice(2).replace(/\.tsx$/, '.ts')), code);
    const requests = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
    let calls = 0;
    const data = createDataRuntime({ fetch: () => requests[calls++]!.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { App } = await import(`${pathToFileURL(join(directory, id + '.ts')).href}?runtime=${Date.now()}`);
      const root = App(id, null) as HTMLElement;
      document.body.append(root);
      expect(root.querySelector('.conditional')!.textContent).toBe('');
      expect(root.querySelector('.nested')!.textContent).toBe('');
      requests[0]!.resolve(Response.json([{ title: 'First' }]));
      await waitFor(() => expect(root.querySelector('.conditional')!.textContent).toBe('1 ready'));
      expect(root.querySelector('.nested')!.textContent).toBe('First');
      expect(root.querySelector('.logical')!.textContent).toBe('First');
      root.querySelector('button')!.click();
      await waitFor(() => expect(root.querySelector('.conditional')!.textContent).toBe('Refreshing'));
      expect(root.querySelector('.nested')!.textContent).toBe('Refreshing');
      expect(root.querySelector('.logical')!.textContent).toBe('');
      requests[1]!.resolve(Response.json([{ title: 'New' }, { title: 'Second' }]));
      await waitFor(() => expect(root.querySelector('.conditional')!.textContent).toBe('2 ready'));
      expect(root.querySelector('.nested')!.textContent).toBe('New');
      expect(root.querySelector('.logical')!.textContent).toBe('New,Second');
      expect(calls).toBe(2);
      expect(document.querySelector('section')).toBe(root);
    } finally {
      unregister(id); data.clear(); setActiveDataRuntime(previous); document.body.replaceChildren();
    }
  });
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

  it('lowers mixed request-state and payload reads inside the helper', async () => {
    const { metadata, output } = compileModulesDetailed({
      './mixed-helper.ts': `
        import { $track } from '@memoized-dom/data';
        export function describe(source) {
          return $track(source).pending
            ? 'Loading'
            : source.length + ' stories';
        }
      `,
      './mixed-app.tsx': `
        import { describe } from './mixed-helper';
        export function MixedApp() {
          const stories = $fetch('/api/mixed-stories');
          const label = describe(stories);
          return <p>{label}</p>;
        }
      `,
    }, { runtimePath: '@memoized-dom/runtime/testing' });

    expect(metadata['./mixed-helper.ts']!.functionExports).toContainEqual(
      expect.objectContaining({
        exported: 'describe',
        parameterSourceReads: [{ index: 0, path: [] }],
        parameterPayloadReads: [{ index: 0, path: [] }],
      }),
    );
    expect(output['./mixed-helper.ts']).toContain(
      '_MDD.readResolvedValue(source',
    );
    expect(output['./mixed-helper.ts']).toContain('$track(source).pending');

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
      const { MixedApp } = await import(
        `${pathToFileURL(join(outDir, 'mixed-app.ts')).href}?runtime=${Date.now()}`
      );
      const paragraph = MixedApp('MixedRequestStateHelper', null) as HTMLParagraphElement;
      document.body.append(paragraph);
      expect(paragraph.textContent).toBe('Loading');

      request.resolve(Response.json([{ id: 1 }, { id: 2 }]));
      await waitFor(() => {
        expect(paragraph.textContent).toBe('2 stories');
      });
      expect(document.querySelector('p')).toBe(paragraph);
    } finally {
      unregister('MixedRequestStateHelper');
      data.clear();
      setActiveDataRuntime(previous);
      document.body.replaceChildren();
    }
  });
});
