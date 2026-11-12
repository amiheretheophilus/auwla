import { afterAll, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArguments, run } from './cli';

// Inside the package (not `src/`), so a build finds the workspace's runtime as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../../.cli-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src', 'App.tsx'), 'export function App() { return <p>hi</p>; }');
writeFileSync(join(root, 'src', 'Broken.tsx'), 'export function Broken() { return <p>{</p>; }');

it('reads its commands and options', () => {
  expect(parseArguments(['check', 'src/App.tsx'], root)).toMatchObject({ name: 'check', entry: './src/App.tsx', root });
  expect(parseArguments(['build', 'src/App.tsx', '--out', 'out', '--minify'], root))
    .toMatchObject({ name: 'build', out: join(root, 'out'), minify: true });
  expect(parseArguments(['build'], root)).toContain('usage');
  expect(parseArguments(['build', 'src/App.tsx', '--wat'], root)).toContain('unknown or incomplete option: --wat');
});

it('checks a program, reporting the first error with its module', async () => {
  const lines: string[] = [];
  expect(await run(parseArguments(['check', 'src/App.tsx'], root) as never, (line) => lines.push(line))).toBe(0);
  expect(lines).toEqual(['ok: 1 modules compiled']);

  lines.length = 0;
  expect(await run(parseArguments(['check', 'src/Broken.tsx'], root) as never, (line) => lines.push(line))).toBe(1);
  expect(lines.join('\n')).toContain('Broken.tsx');
});

it('builds a program into its output folder, with source maps', async () => {
  const command = parseArguments(['build', 'src/App.tsx', '--out', 'dist'], root);
  if (typeof command === 'string') throw new Error(command);
  const lines: string[] = [];
  expect(await run(command, (line) => lines.push(line))).toBe(0);
  expect(existsSync(join(root, 'dist', 'App.js'))).toBe(true);
  expect(readdirSync(join(root, 'dist')).some((name) => name.endsWith('.map'))).toBe(true);
  // The markup compiled to a template, with the runtime bundled in.
  const bundle = await Bun.file(join(root, 'dist', 'App.js')).text();
  expect(bundle).toContain('_template');
  expect(bundle).toContain('runtime/dist/markup.js');
});
