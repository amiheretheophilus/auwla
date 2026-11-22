import '../../../test-support/dom';
/**
 * Streamed regions of a numbered page (compiler output, `src/stream-regions.ts`): what the server
 * sends as a source settles, and how the browser's bootstrap applies it before the program mounts.
 */
import { afterEach, expect, it } from 'bun:test';
import { RegionTracker, streamBootstrap } from '../src/stream-regions';
import { StringDocument, writeCreations, type StringRenderableNode } from '../src/string-document';

/** A component's root element `<main>` (creation 0) holding a button (creation 3v:0). */
function numberedRoot() {
  const document = new StringDocument();
  const ids = new WeakMap<object, string>();
  const main = document.createElement('main') as unknown as StringRenderableNode;
  const button = document.createElement('button') as unknown as StringRenderableNode;
  main.appendChild(button);
  ids.set(main, '0');
  ids.set(button, '3v:0');
  const serialize = (node: StringRenderableNode) => writeCreations(ids, () => node.toString(true, false));
  const tracker = new RegionTracker(main, serialize, (node) => ids.get(node));
  return { document, ids, main, button, tracker };
}

const generation = (sequence: number, body: string) =>
  `<div style="display:contents" data-mmd-page-render="g" data-mmd-page-sequence="${sequence}">${body}</div>`;

it("sends the root element when content goes straight into it, as a server page's first frame does", () => {
  // Before 2026-11-22 only the numbered elements inside the root were regions, so the page the
  // value slot put into <main> reached the browser only when the document ended.
  const { document, ids, main, button, tracker } = numberedRoot();
  const page = document.htmlWriter.create(() => generation(1, '<h2>Available</h2>')) as unknown as StringRenderableNode;
  ids.set(page, '1v:0');
  main.insertBefore(page, button);

  const regions = tracker.changes();
  expect(regions.map((region) => region.id)).toEqual(['[0']);
  expect(regions[0]!.html).toContain('<!--[1v:0--><div style="display:contents" data-mmd-page-render="g"');
});

it("leaves a progressive page's later generations to its source delta", () => {
  const { document, ids, main, button, tracker } = numberedRoot();
  let html = generation(1, '<p>Loading</p>');
  const page = document.htmlWriter.create(() => html) as unknown as StringRenderableNode;
  ids.set(page, '1v:0');
  main.insertBefore(page, button);
  tracker.changes();

  const before = html;
  html = generation(2, '<p>Ready</p>');
  // Its own regions travel in the delta; resending the root would replace what the user typed.
  expect(tracker.changes([{ before, after: html }])).toEqual([]);
  // Anything else that changed is still sent.
  const previous = html;
  html = generation(3, '<p>Done</p>');
  main.appendChild(document.createElement('footer') as unknown as StringRenderableNode);
  expect(tracker.changes([{ before: previous, after: html }]).map((region) => region.id)).toEqual(['[0']);
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'currentScript');
  Reflect.deleteProperty(globalThis, '__mmdS');
});

it('fills a numbered page region in the server HTML before the program mounts', () => {
  // Before 2026-11-22 the bootstrap looked for marker ranges only, so a compiled page's sections
  // stayed pending until the browser's program mounted.
  const state = { formatVersion: 1, sources: [{
    sourceId: 'page', contractId: 'mmd-fetch/v1:page:1', requestFingerprint: 'page',
    snapshot: { status: 'success', data: { $mmd: 'page', version: 1, id: 'p', html: '',
      progress: { id: 'g', sequence: 2, complete: false,
        regions: [{ id: '[2v:1', html: '<!--[2v:1--><article>Summary ready</article>', sequence: 2 }] } } },
  }] };
  document.body.innerHTML = '<script type="application/mmd+json" data-mmd-root="app">{"version":1}</script>'
    + generation(1, '<input><!--[2v:1--><article>Loading</article>')
    + `<script type="application/mmd+json" data-mmd-delta="app">${JSON.stringify(state)}</script><script></script>`;
  const input = document.querySelector('input')!;
  const bootstrap = streamBootstrap(undefined);
  new Function(bootstrap.slice(bootstrap.indexOf('>') + 1, -'</script>'.length))();

  // `__mmdS` reads the delta just before the script that calls it.
  const caller = document.body.lastElementChild;
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => caller });
  (globalThis as unknown as { __mmdS(root: string, ids: string[]): void }).__mmdS('app', []);

  expect(document.querySelector('article')?.textContent).toBe('Summary ready');
  expect(document.querySelector('input')).toBe(input);
  expect(document.querySelector('[data-mmd-page-render]')?.getAttribute('data-mmd-page-sequence')).toBe('2');
});
