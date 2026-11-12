import { afterAll, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoizedDom } from './bun';
import { createProject, fileSystemHost } from '.';

const root = mkdtempSync(join(tmpdir(), 'compiler-next-bun-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

// Read through a namespace, a module with state keeps its readers in a companion output, which
// exists only in the build (`linking.md`).
write('src/main.tsx', `
import { mount } from '@memoized-dom/runtime';
import * as app from './App';
mount(app.App, document.body);
`);
write('src/App.tsx', `
import { Title } from './Title';
import './styles.css';
export let clicks = 0;
export function App() { return <main><Title text="hi" /><button onClick={() => clicks++}>{clicks}</button></main>; }
`);
write('src/Title.tsx', 'export function Title({ text }: { text: string }) { return <h1>{text}</h1>; }');
write('src/styles.css', 'main { color: red; }');

it('builds an app with Bun, its modules compiled and its companion outputs found', async () => {
  // The app has a companion output, which Bun must resolve through the plugin.
  const project = await createProject({ entries: ['./src/main.tsx'], host: fileSystemHost(root) }).build();
  expect(project.ok && Object.keys(project.output).some((path) => /\.mmd\./.test(path))).toBe(true);

  const result = await Bun.build({
    entrypoints: [join(root, 'src/main.tsx')],
    plugins: [memoizedDom({ entries: ['./src/main.tsx'], root })],
    external: ['@memoized-dom/*'],
    sourcemap: 'external',
  });

  expect(result.success).toBe(true);
  const script = result.outputs.find((output) => output.path.endsWith('.js'))!;
  const code = await script.text();
  // Compiled: templates instead of JSX calls, and the runtime imported by the output.
  expect(code).toContain('createTemplateCache');
  expect(code).not.toContain('jsx(');
  expect(code).toContain('@memoized-dom/runtime');
  // The styles went to Bun, as a bundler's asset.
  expect(result.outputs.some((output) => output.path.endsWith('.css'))).toBe(true);
});

it('reports a compile error with its module', async () => {
  write('src/Broken.tsx', 'export function Broken() { return <p>{</p>; }');
  write('src/broken-main.tsx', `import { Broken } from './Broken'; console.log(Broken);`);
  const result = await Bun.build({
    entrypoints: [join(root, 'src/broken-main.tsx')],
    plugins: [memoizedDom({ entries: ['./src/broken-main.tsx'], root })],
    external: ['@memoized-dom/*'],
    throw: false,
  });
  expect(result.success).toBe(false);
  expect(result.logs.map((log) => log.message).join('\n')).toContain('Broken.tsx');
});
