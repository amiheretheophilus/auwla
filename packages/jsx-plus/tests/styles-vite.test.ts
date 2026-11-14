/** The compiler's existing Vite adapter owns CSS delivery and updates. */
import { afterAll, afterEach, expect, it, vi } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, createServer, type Rolldown, type ViteDevServer } from 'vite';
import { waitFor } from '../../../test-support/helpers';
import memoizedDom from '../../vite/src';
import { memoizedDom as compilerBun } from '../../compiler-next/src/project/bun';
import { auwla } from '../src';
import { readStyleBlocks } from '../src/styles/blocks';

const copies: string[] = [];
/** A copy of the test's own app `fixtures/apps/<name>` in a temporary folder of this package. */
function copyExample(name = 'styling'): string {
  const copy = mkdtempSync(join(import.meta.dir, `../.vite-test-${name}-`));
  cpSync(join(import.meta.dir, 'fixtures/apps', name), copy, { recursive: true });
  rmSync(join(copy, 'tsconfig.json'));
  copies.push(copy);
  return copy;
}
const root = copyExample();
afterAll(() => {
  for (const copy of copies) {
    rmSync(copy, { recursive: true, force: true });
  }
});

let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const config = {
  root,
  configFile: false as const,
  logLevel: 'silent' as const,
  plugins: [memoizedDom({ compiler: 'next', clientEntry: 'main.ts', languages: [auwla] })],
};

it('builds the real HTML entry with native CSS imports, URLs and stylesheet links', async () => {
  const result = await build({ ...config, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const assets = outputs.flatMap((output) => output.output);
  const css = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.css'));
  expect(css).toBeDefined();
  expect(String(css!.source)).toContain('.css-demo.loading');
  expect(String(css!.source)).toContain('box-sizing:border-box');
  expect(String(css!.source)).not.toContain("@import './reset.css'");
  expect(String(css!.source)).toMatch(/url\(/);
  const html = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.html'))!;
  expect(String(html.source)).toContain(css!.fileName);
}, 60_000);

it('builds full-property class conditions through the same compiler-owned CSS path', async () => {
  const copy = mkdtempSync(join(import.meta.dir, '../.vite-test-class-conditions-'));
  copies.push(copy);
  cpSync(join(import.meta.dir, 'fixtures/apps/class-conditions'), copy, { recursive: true });
  rmSync(join(copy, 'tsconfig.json'));
  const result = await build({ ...config, root: copy, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const css = outputs.flatMap((output) => output.output).find((asset): asset is Rolldown.OutputAsset =>
    asset.type === 'asset' && asset.fileName.endsWith('.css'))!;
  expect(String(css.source)).toContain('.card.loading');
  expect(String(css.source)).toContain('.card.expanded');
  expect(String(css.source)).toMatch(/\.card\.error::?before/);
  expect(String(css.source)).not.toContain('@.');
}, 60_000);

it('builds and hot-updates numeric responsive rules through native CSS delivery', async () => {
  const responsiveRoot = copyExample('responsive');
  const result = await build({ ...config, root: responsiveRoot, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const assets = outputs.flatMap((output) => output.output);
  const css = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.css'))!;
  expect(String(css.source)).toContain('@media');
  expect(String(css.source)).toContain('700px');
  expect(String(css.source)).not.toMatch(/@(?:300|700|1000|\.)/);
  const html = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.html'))!;
  expect(String(html.source)).toContain(css.fileName);

  server = await createServer({ ...config, root: responsiveRoot, server: { middlewareMode: true } });
  const client = server.environments.client;
  for (const path of ['/main.ts', '/App.auwla', '/Card.auwla', '/Card.auwla.css']) {
    await client.transformRequest(path);
  }
  const original = (await client.transformRequest('/Card.auwla'))!.code;
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  const file = join(responsiveRoot, 'shared.auwla');
  writeFileSync(file, readFileSync(file, 'utf8').replace('@700px:24px', '@800px:28px'));
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  await waitFor(() => expect(payloads().flatMap((payload) => payload.updates ?? [])
    .some((update) => update.acceptedPath === '/Card.auwla.css')).toBe(true), { timeout: 15_000 });
  expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
  expect(payloads().flatMap((payload) => payload.updates ?? [])
    .some((update) => update.acceptedPath.endsWith('.auwla'))).toBe(false);
  const updated = (await client.transformRequest('/Card.auwla'))!.code;
  expect(updated.replace(/(import "\/Card\.auwla\.css)\?t=\d+(")/, '$1$2')).toBe(original);
  const updatedCss = (await client.transformRequest('/Card.auwla.css'))!.code;
  expect(updatedCss).toMatch(/min-width:\s*800px/);
  expect(updatedCss).toContain('28px');
}, 60_000);

it('keeps generated CSS when a fully static page ships without a script', async () => {
  const staticRoot = copyExample();
  writeFileSync(join(staticRoot, 'App.auwla'),
    '<style global>.static-card { padding: 4px; }</style>\nexport function App() { return <main class="static-card">"Static page"</main>; }');
  // A static mount entry does only mount(); exporting its result requires browser code.
  const entry = join(staticRoot, 'main.ts');
  writeFileSync(entry, readFileSync(entry, 'utf8').replace('export const application = ', ''));
  const result = await build({ ...config, root: staticRoot, build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const assets = outputs.flatMap((output) => output.output);
  const css = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.css'))!;
  const html = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.html'))!;
  expect(String(css.source)).toContain('.static-card');
  expect(String(html.source)).toContain('Static page');
  expect(String(html.source)).toContain(css.fileName);
  expect(String(html.source)).not.toContain('<script');

  const bun = await Bun.build({
    entrypoints: [join(staticRoot, 'index.html')], target: 'browser',
    plugins: [compilerBun({ root: staticRoot, client: './main.ts', languages: [auwla] })],
  });
  expect(bun.success).toBe(true);
  const bunCss = bun.outputs.find((output) => output.path.endsWith('.css'))!;
  expect(await bunCss.text()).toContain('.static-card');
  expect(await bun.outputs.find((output) => output.path.endsWith('.html'))!.text()).toContain('.css');
}, 60_000);

it('builds the real scope gallery through native Vite CSS delivery', async () => {
  const result = await build({ ...config, root: copyExample('scoping'), build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const assets = outputs.flatMap((output) => output.output);
  const css = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.css'))!;
  const html = assets.find((asset): asset is Rolldown.OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.html'))!;
  expect(String(css.source)).toContain(':where([data-mmd-s-');
  expect(String(css.source)).not.toContain('@use');
  expect(String(css.source)).not.toContain('@.');
  expect(String(html.source)).toContain(css.fileName);
}, 60_000);

it('hot-updates reused local CSS without replacing component JavaScript or scope identities', async () => {
  const scopedRoot = copyExample('scoping');
  server = await createServer({ ...config, root: scopedRoot, server: { middlewareMode: true } });
  const client = server.environments.client;
  for (const path of ['/main.ts', '/App.auwla', '/Cards.auwla', '/Cards.auwla.css']) {
    await client.transformRequest(path);
  }
  const original = (await client.transformRequest('/Cards.auwla'))!.code;
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  const file = join(scopedRoot, 'Cards.auwla');
  // Change the source width as well as the CSS value: neither scope identities
  // nor the component program should depend on the removed block's byte offsets.
  writeFileSync(file, readFileSync(file, 'utf8').replace('border-color: teal', 'border-color: rebeccapurple'));
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  await waitFor(() => expect(payloads().flatMap((payload) => payload.updates ?? [])
    .some((update) => update.acceptedPath.includes('Cards.auwla.css'))).toBe(true), { timeout: 15_000 });
  expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
  expect(payloads().flatMap((payload) => payload.updates ?? [])
    .some((update) => update.acceptedPath === '/Cards.auwla')).toBe(false);
  // Vite updates only the CSS dependency's timestamp in its served module.
  // Compare the component program after removing precisely that native cache key.
  const updated = (await client.transformRequest('/Cards.auwla'))!.code;
  expect(updated.replace(/(import "\/Cards\.auwla\.css)\?t=\d+(")/, '$1$2')).toBe(original);
  expect((await client.transformRequest('/Cards.auwla.css'))!.code).toContain('rebeccapurple');
}, 60_000);

it('serves CSS in dev and hot-updates a CSS-only edit', async () => {
  server = await createServer({ ...config, server: { middlewareMode: true } });
  const client = server.environments.client;
  for (const path of ['/main.ts', '/App.auwla', '/App.auwla.css']) {
    const transformed = await client.transformRequest(path);
    expect(transformed).toBeTruthy();
  }
  const css = await client.transformRequest('/App.auwla.css');
  expect(css!.code).toContain('.css-demo.loading');

  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  const file = join(root, 'App.auwla');
  writeFileSync(file, readFileSync(file, 'utf8').replace('#d97706', '#dc2626'));
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  await waitFor(() => expect(payloads().flatMap((payload) => payload.updates ?? [])
    .some((update) => update.acceptedPath.includes('App.auwla.css'))).toBe(true), { timeout: 15_000 });
  expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
  expect(payloads().flatMap((payload) => payload.updates ?? [])
    .some((update) => update.acceptedPath === '/App.auwla')).toBe(false);
  expect((await client.transformRequest('/App.auwla.css'))!.code).toContain('#dc2626');
}, 60_000);

it('watches a source-only definition and hot-updates every consuming CSS asset', async () => {
  const scopedRoot = copyExample('scoping');
  server = await createServer({ ...config, root: scopedRoot, server: { middlewareMode: true } });
  const client = server.environments.client;
  for (const path of ['/main.ts', '/App.auwla', '/Cards.auwla', '/Cards.auwla.css', '/IndependentCard.auwla', '/IndependentCard.auwla.css']) {
    await client.transformRequest(path);
  }
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  const file = join(scopedRoot, 'styles/Frames.auwla');
  writeFileSync(file, readFileSync(file, 'utf8').replace('@.expanded:32px', '@.expanded:400px'));
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  const updated = () => payloads().flatMap((payload) => payload.updates ?? []).map((update) => update.acceptedPath);
  await waitFor(() => {
    expect(updated()).toContain('/Cards.auwla.css');
    expect(updated()).toContain('/IndependentCard.auwla.css');
  }, { timeout: 15_000 });
  expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
  expect(updated().some((path) => path.endsWith('.auwla'))).toBe(false);
  expect((await client.transformRequest('/Cards.auwla.css'))!.code).toContain('400px');
  expect((await client.transformRequest('/IndependentCard.auwla.css'))!.code).toContain('400px');
}, 60_000);

it('recovers a broken style-only dependency through CSS updates without replacing components', async () => {
  const scopedRoot = copyExample('scoping');
  // The native watcher suppresses repeated same-file changes inside 50 ms.
  // This test restores immediately after an error: use write-finish events so
  // each save is delivered, without sleeps or weakening the recovery assertions.
  server = await createServer({ ...config, root: scopedRoot, server: {
    middlewareMode: true,
    watch: { awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 10 } },
  } });
  const client = server.environments.client;
  const fileEvents: { file: string; at: number }[] = [];
  server.watcher.on('change', (file) => fileEvents.push({ file, at: Date.now() }));
  for (const path of ['/main.ts', '/App.auwla', '/Cards.auwla', '/Cards.auwla.css', '/IndependentCard.auwla', '/IndependentCard.auwla.css']) {
    await client.transformRequest(path);
  }
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  const file = join(scopedRoot, 'styles/Frames.auwla');
  const original = readFileSync(file, 'utf8');
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  for (let cycle = 0; cycle < 3; cycle++) {
    send.mockClear();
    writeFileSync(file, original.replace('id="card-frame"', 'id="renamed"'));
    await waitFor(() => expect(payloads().some((payload) => payload.type === 'error')).toBe(true), { timeout: 15_000 });
    send.mockClear();
    writeFileSync(file, original);
    await waitFor(() => expect(payloads().flatMap((payload) => payload.updates ?? [])
      .some((update) => update.acceptedPath.endsWith('.auwla.css'))).toBe(true), { timeout: 15_000 })
      .catch((cause) => { throw new Error(JSON.stringify({ cycle, fileEvents, payloads: payloads() }), { cause }); });
    expect(payloads().some((payload) => payload.type === 'full-reload')).toBe(false);
    expect(payloads().flatMap((payload) => payload.updates ?? [])
      .some((update) => update.acceptedPath.endsWith('.auwla'))).toBe(false);
    expect((await client.transformRequest('/Cards.auwla.css'))!.code).toContain('32px');
  }
}, 60_000);

it('prunes the CSS module when its author removes all style blocks', async () => {
  server = await createServer({ ...config, server: { middlewareMode: true } });
  const client = server.environments.client;
  for (const path of ['/main.ts', '/App.auwla', '/App.auwla.css']) {
    await client.transformRequest(path);
  }
  const send = vi.spyOn(client.hot, 'send').mockImplementation(() => {});
  type Payload = { type: string; updates?: { acceptedPath: string }[] };
  const payloads = () => send.mock.calls.map(([payload]) => payload as unknown as Payload);
  const file = join(root, 'App.auwla');
  // Removing the blocks removes the import. Vite prunes its CSS module and its style element.
  const authored = readFileSync(file, 'utf8');
  writeFileSync(file, readStyleBlocks(authored, file).host);
  await waitFor(() => expect(payloads().flatMap((payload) => payload.updates ?? [])
    .map((update) => update.acceptedPath)).toContain('/App.auwla'), { timeout: 15_000 });
  const withoutCss = await client.transformRequest('/App.auwla');
  expect(withoutCss!.code).not.toContain('App.auwla.css');
  await waitFor(() => expect(send.mock.calls.some(([payload]) => {
    const message = payload as unknown as { type: string; paths?: string[] };
    return message.type === 'prune' && message.paths?.includes('/App.auwla.css') === true;
  })).toBe(true), { timeout: 15_000 });
}, 60_000);
