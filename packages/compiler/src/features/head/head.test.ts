/**
 * `<head>` in markup: its tags reach the document's head and follow what they read, the deepest
 * component's tag wins for each key, `index.html`'s comes back when nothing overrides it, and the
 * compiler stops a `<head>` that holds anything but head tags.
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resetScheduler, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

const OPTIONS = { entries: ['./App.tsx'], runtimePath: '@memoized-dom/runtime/testing' } as const;
const applications: MountedApplication[] = [];
let sequence = 0;

beforeEach(() => {
  document.head.innerHTML = '<meta charset="utf-8"><title>Site</title><meta name="description" content="The site">';
});

afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  resetScheduler();
  document.head.replaceChildren();
});

async function mountApp(app: string): Promise<HTMLElement> {
  const directory = join(import.meta.dirname, '../../../tests/out/head', `build-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'App.tsx'), compileModules({ './App.tsx': app }, OPTIONS)['./App.tsx']!);
  setScheduler((run) => run());
  const module = await import(pathToFileURL(join(directory, 'App.tsx')).href);
  const host = document.createElement('div');
  document.body.append(host);
  applications.push(module.start(host));
  return host;
}

/** The page's title, as the browser shows it. */
function title(): string {
  return document.title;
}

/** The head's tags, as text: what the browser shows and crawlers read. */
function head(): string {
  return [...document.head.children].map((tag) => {
    const attributes = [...tag.attributes].filter((attribute) => attribute.name !== 'data-mmd-head')
      .map((attribute) => ` ${attribute.name}="${attribute.value}"`).join('');
    return `<${tag.tagName.toLowerCase()}${attributes}>${tag.textContent}`;
  }).join(' ');
}

it('puts its tags in the document head, follows what they read, and leaves nothing in the page', async () => {
  const host = await mountApp(`
    import { mount } from '@memoized-dom/runtime/testing';
    export function App() {
      let count = 1;
      return (
        <main>
          <head>
            <title>{'Count ' + count}</title>
            <meta name="description" content={'Clicked ' + count} />
          </head>
          <button onClick={() => count++}>more</button>
        </main>
      );
    }
    export function start(host) { return mount(host, App); }
  `);

  // Only the value site's own anchor, a comment, stays where `<head>` was written.
  expect(host.querySelector('main')!.innerHTML.replace(/<!--.*?-->/g, '')).toBe('<button>more</button>');
  expect(head()).toBe('<meta charset="utf-8"> <title>Count 1 <meta name="description" content="Clicked 1">');
  expect(title()).toBe('Count 1');

  host.querySelector('button')!.click();
  expect(title()).toBe('Count 2');
  expect(head()).toContain('<meta name="description" content="Clicked 2">');
  host.remove();
});

it('lets the deepest component win for a key, and brings back what it covered when it goes', async () => {
  const host = await mountApp(`
    import { mount } from '@memoized-dom/runtime/testing';
    function Page() {
      return <section><head><title>Payments</title></head><p>page</p></section>;
    }
    export function App() {
      let open = true;
      return (
        <main>
          <button onClick={() => { open = !open; }}>toggle</button>
          {open && <Page />}
          <head><title>Desk</title><meta property="og:site_name" content="Triaxis" /></head>
        </main>
      );
    }
    export function start(host) { return mount(host, App); }
  `);

  // The page is deeper than the layout, though the layout's <head> comes later in its markup.
  expect(title()).toBe('Payments');
  expect(head()).toContain('<meta property="og:site_name" content="Triaxis">');

  host.querySelector('button')!.click();
  expect(title()).toBe('Desk');

  for (const app of applications.splice(0)) app.unmount();
  // index.html's own tags are back, and only those.
  expect(head()).toBe('<meta charset="utf-8"> <title>Site <meta name="description" content="The site">');
  host.remove();
});

it('reads the head afresh once every block is gone, as after hot replacement', async () => {
  const app = `
    import { mount } from '@memoized-dom/runtime/testing';
    export function App() { return <main><head><title>Mounted</title></head></main>; }
    export function start(host) { return mount(host, App); }
  `;
  const first = await mountApp(app);
  for (const mounted of applications.splice(0)) mounted.unmount();
  first.remove();
  expect(title()).toBe('Site');

  // The page's own title changes while nothing covers it; the next block sets aside the new one.
  document.head.innerHTML = '<title>Edited</title>';
  const second = await mountApp(app);
  expect(title()).toBe('Mounted');
  for (const mounted of applications.splice(0)) mounted.unmount();
  expect(title()).toBe('Edited');
  second.remove();
});

it('leaves a module with no <head> as it was', () => {
  const source = `export function App() { return <header><h1>Hi</h1></header>; }`;
  expect(compileModules({ './App.tsx': source }, OPTIONS)['./App.tsx']).not.toContain('headValue');
});

for (const [name, markup, message] of [
  ['an element that is not a head tag', '<head><div>x</div></head>', '<head> holds title, meta and link tags; <div> belongs in the page. For the page\'s header, write <header>'],
  ['two titles', '<head><title>A</title><title>B</title></head>', 'a <head> sets one <title>'],
  ['an attribute', '<head lang="en"><title>A</title></head>', '<head> takes no attributes'],
  ['text', '<head>hello</head>', '<head> holds title, meta and link tags, not text'],
] as const) {
  it(`stops a <head> with ${name}`, () => {
    const source = `export function App() { return <main>${markup}</main>; }`;
    expect(() => compileModules({ './App.tsx': source }, OPTIONS)).toThrow(message);
  });
}
