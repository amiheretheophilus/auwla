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

const example = fileURLToPath(new URL('../examples/notes/', import.meta.url));
const root = mkdtempSync(join(import.meta.dir, '../.vite-test-'));
cpSync(example, root, { recursive: true });
// Its editor config extends a sibling folder the copy does not have; Vite would read it.
rmSync(join(root, 'tsconfig.json'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

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
