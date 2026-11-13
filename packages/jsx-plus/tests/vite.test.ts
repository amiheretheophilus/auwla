/**
 * The notes example through compiler-next's Vite plugin (`packages/vite/src/next/plugin.ts`), with
 * JSX+ only as a source language: a production build, and a dev server that compiles a `.auwla`
 * module, maps it, and hot-updates it on an edit. The example is copied into a temporary folder in
 * this package, so edits never touch it and the build finds the workspace's packages.
 */
import { afterAll, afterEach, expect, it, vi } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type Rolldown, type ViteDevServer } from 'vite';
import { waitFor } from '../../../test-support/helpers';
// The package export is the built `dist`; Vite's own tests read the source the same way.
import memoizedDom from '../../vite/src';
import { auwla } from '../src';

const copies: string[] = [];
afterAll(() => {
  for (const copy of copies) rmSync(copy, { recursive: true, force: true });
});

/** A copy of `examples/<name>` in a temporary folder of this package. */
function copyExample(name: string): string {
  const copy = mkdtempSync(join(import.meta.dir, `../.vite-test-${name}-`));
  copies.push(copy);
  cpSync(fileURLToPath(new URL(`../examples/${name}/`, import.meta.url)), copy, { recursive: true });
  // Its editor config extends a sibling folder the copy does not have; Vite would read it.
  rmSync(join(copy, 'tsconfig.json'));
  return copy;
}

const root = copyExample('notes');

let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const config = {
  root,
  configFile: false as const,
  logLevel: 'silent' as const,
  plugins: [memoizedDom({ clientEntry: 'main.ts', compiler: 'next', languages: [auwla] })],
};

it('builds the app with Vite, every .auwla module compiled', async () => {
  const result = await build({ ...config, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');
  const code = chunks.map((chunk) => chunk.code).join('\n');
  // Text from each component, and no JSX left: compiler-next compiled all three.
  expect(code).toContain('No notes yet.');
  expect(code).toContain('Write a note');
  expect(code).toContain('Notes');
  expect(code).not.toContain('<form');
  expect(code).not.toContain('jsx(');
}, 60_000);

it('splits each routed .auwla page into its own chunk in a Vite build', async () => {
  const team = copyExample('team');
  const result = await build({ ...config, root: team, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');
  const entry = chunks.find((chunk) => chunk.isEntry)!;

  // The home section and the locally declared not-found page ship with the entry.
  expect(entry.code).toContain('Team directory');
  expect(entry.code).toContain('No page here.');
  // Each page imported only for its route is in a chunk of its own, which the entry imports lazily.
  for (const text of ['Search people', 'Back to everyone', 'all written in .auwla']) {
    expect([text, entry.code.includes(text)]).toEqual([text, false]);
    const page = chunks.find((chunk) => !chunk.isEntry && chunk.code.includes(text));
    expect([text, page !== undefined]).toEqual([text, true]);
    expect(entry.dynamicImports).toContain(page!.fileName);
  }
}, 60_000);

it('compiles a .auwla module in dev, maps it, and hot-updates it on an edit', async () => {
  server = await createServer({ ...config, server: { middlewareMode: true } });
  const client = server.environments.client;
  const transformed = await client.transformRequest('/components/NoteList.auwla');
  expect(transformed?.code).toContain('import.meta.hot.accept');
  expect(transformed?.code).not.toContain('<li');
  const map = transformed?.map as { sources?: string[] } | null | undefined;
  expect(map?.sources?.some((source) => source.endsWith('NoteList.auwla'))).toBe(true);

  for (const path of ['/main.ts', '/App.auwla', '/NoteForm.auwla', '/components/index.ts', '/notes.ts']) {
    await client.transformRequest(path);
  }
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  const accepted = () => payloads().flatMap((payload) => payload.updates ?? []).map((update) => update.acceptedPath);

  // A component module accepts its own update, as a `.tsx` one does.
  const file = join(root, 'components/NoteList.auwla');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"No notes yet."', '"Nothing saved yet."'));
  await waitFor(() => expect(accepted()).toContain('/components/NoteList.auwla'), { timeout: 15_000 });
  expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
}, 60_000);

it('reports a .auwla syntax error with its authored place in dev', async () => {
  server = await createServer({ ...config, server: { middlewareMode: true } });
  const client = server.environments.client;
  await client.transformRequest('/NoteForm.auwla');
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});

  const file = join(root, 'NoteForm.auwla');
  const good = readFileSync(file, 'utf8');
  // An unterminated quoted child on line 20.
  writeFileSync(file, good.replace('<button type="submit">"Add"</button>', '<button type="submit">"Add</button>'));
  type ErrorPayload = { type: string; err?: { message: string; id?: string; loc?: { line: number } } };
  await waitFor(() => {
    const error = send.mock.calls.map(([payload]) => payload as unknown as ErrorPayload).find((payload) => payload.type === 'error');
    expect(error?.err?.message).toContain('NoteForm.auwla');
    expect(error?.err?.loc?.line).toBe(20);
  }, { timeout: 15_000 });
  writeFileSync(file, good);
}, 30_000);
