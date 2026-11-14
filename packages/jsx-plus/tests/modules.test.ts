/**
 * A multi-file `.auwla` app through compiler-next's own tools, with JSX+ only as a source language
 * (`src/language.ts`): compiler-next's project collects it, and its Bun plugin bundles it. Nothing
 * here is a JSX+ build path. `examples/notes` has three `.auwla` components, one imported by its
 * full name and one through a `.ts` re-export with no extension, and a `.ts` helper with module state.
 */
import { afterEach, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createProject, fileSystemHost, type ProjectHost, type SourceLanguage } from '@memoized-dom/compiler-next';
// Compiler-next's Bun plugin has no package export yet; the test reads it as the CLI does.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import * as runtime from '../../runtime/src/index';
import { auwla } from '../src';

const root = fileURLToPath(new URL('../examples/notes/', import.meta.url));
const entry = fileURLToPath(new URL('../examples/notes/main.ts', import.meta.url));

const applications: runtime.MountedApplication[] = [];
afterEach(() => {
  for (const application of applications.splice(0)) application.unmount();
  runtime.resetScheduler();
  document.body.replaceChildren();
});

/** Bundles the example with compiler-next's Bun plugin, keeping the runtime outside the bundle. */
async function bundle(optimize: boolean, sourcemap: 'none' | 'external' = 'none') {
  return Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    sourcemap,
    external: ['@memoized-dom/*'],
    plugins: [memoizedDom({ client: './main.ts', root, optimize, languages: [auwla] })],
  });
}

/** Runs the bundle against this checkout's runtime, mounted in a fresh `#app`. */
async function start(optimize: boolean) {
  const result = await bundle(optimize);
  expect(result.success).toBe(true);
  const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();

  const module = toModuleFunction(code);
  const imports = module.specifiers.map((specifier) => {
    expect(specifier).toBe('@memoized-dom/runtime');
    return runtime;
  });
  runtime.setScheduler((run) => run());
  const container = document.createElement('div');
  container.id = 'app';
  document.body.append(container);
  const exports: Record<string, unknown> = {};
  new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
    imports, exports, () => {}, ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
  );
  applications.push(exports.application as runtime.MountedApplication);
  return container;
}

it('collects the app through compiler-next\'s project, .auwla modules under their own paths', async () => {
  const build = await createProject({ entries: ['./main.ts'], host: fileSystemHost(root), languages: [auwla] }).build();
  expect(build.ok).toBe(true);
  expect([...build.modules].sort()).toEqual([
    './App.auwla', './NoteForm.auwla', './components/NoteList.auwla', './components/index.ts', './main.ts', './notes.ts',
  ]);
  // Without the language, compiler-next does not read `.auwla` at all: JSX+ adds nothing else.
  const plain = await createProject({ entries: ['./main.ts'], host: fileSystemHost(root) }).build();
  expect(plain.modules).toEqual(['./main.ts']);
});

it('normalizes each .auwla module once per change, though the project asks twice', async () => {
  // The project asks once for a module's imports and once to compile it. A fresh normalization
  // returns a new object, so the same object twice means the second ask did no work.
  const answers = new Map<string, Set<unknown>>();
  const calls = new Map<string, number>();
  const watched: SourceLanguage = {
    extensions: auwla.extensions,
    toTsx(text, path) {
      const result = auwla.toTsx(text, path);
      calls.set(path, (calls.get(path) ?? 0) + 1);
      answers.set(path, (answers.get(path) ?? new Set()).add(result));
      return result;
    },
  };
  const files = fileSystemHost(root);
  const build = await createProject({ entries: ['./main.ts'], host: files, languages: [watched] }).build();
  expect(build.ok).toBe(true);
  expect(calls.get('./App.auwla')).toBe(2);
  expect([...answers.values()].map((results) => results.size)).toEqual([1, 1, 1]);

  // An edit is normalized again; the edited text's two asks share that one result.
  answers.clear();
  const edited: ProjectHost = {
    ...files,
    readFile: async (path) => {
      const text = await files.readFile(path);
      return path.endsWith('App.auwla') ? `${text}\n// edited\n` : text;
    },
  };
  await createProject({ entries: ['./main.ts'], host: edited, languages: [watched] }).build();
  const app = [...answers.get('./App.auwla')!];
  expect(app).toHaveLength(1);
  expect((app[0] as { code: string }).code).toContain('// edited');

  // A syntax error is reported again, the same error, without normalizing again.
  const broken = '<p>"a" <b>"x"</b></p>;\n';
  const first = (() => { try { auwla.toTsx(broken, './Broken.auwla'); } catch (error) { return error; } })();
  const second = (() => { try { auwla.toTsx(broken, './Broken.auwla'); } catch (error) { return error; } })();
  expect(first).toBeInstanceOf(Error);
  expect(second).toBe(first);
});

for (const optimize of [true, false]) {
  it(`runs the bundled app with optimize=${optimize}`, async () => {
    const container = await start(optimize);
    const titles = () => [...container.querySelectorAll('li span')].map((span) => span.textContent);
    const count = () => container.querySelector('.count')!.textContent;
    expect(titles()).toEqual(['Write the first note']);
    expect(count()).toBe('1 saved');

    // The form component reports through its `onAdd` prop to the app's state.
    const input = container.querySelector('input')!;
    input.value = 'Ship the multi-file example';
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(titles()).toEqual(['Write the first note', 'Ship the multi-file example']);
    expect(count()).toBe('2 saved');
    expect(input.value).toBe('');

    // The list component's row handler removes through `onRemove`.
    (container.querySelector('li button') as HTMLButtonElement).click();
    expect(titles()).toEqual(['Ship the multi-file example']);
    (container.querySelector('li button') as HTMLButtonElement).click();
    expect(titles()).toEqual([]);
    expect(container.querySelector('.empty')?.textContent).toBe('No notes yet.');
    expect(count()).toBe('0 saved');
  });
}

it('maps the bundle back to the .auwla files', async () => {
  const result = await bundle(true, 'external');
  expect(result.success).toBe(true);
  const map = JSON.parse(await result.outputs.find((output) => output.path.endsWith('.js.map'))!.text()) as { sources: string[] };
  for (const file of ['App.auwla', 'NoteForm.auwla', 'NoteList.auwla']) {
    expect(map.sources.some((source) => source.endsWith(file))).toBe(true);
  }
});

it('reports a broken .auwla module at its authored place through the project', async () => {
  const files = fileSystemHost(root);
  const broken = 'export function NoteForm() {\n  return <form>"unfinished</form>;\n}\n';
  const host: ProjectHost = { ...files, readFile: (path) => (path === './NoteForm.auwla' ? broken : files.readFile(path)) };
  const build = await createProject({ entries: ['./main.ts'], host, languages: [auwla] }).build();
  expect(build.ok).toBe(false);
  if (!build.ok) {
    expect(build.error.path).toBe('./NoteForm.auwla');
    expect(build.error.line).toBe(2);
  }
});
