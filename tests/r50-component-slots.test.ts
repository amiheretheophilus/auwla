/** Compiler-owned default and named component slots. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  compile,
  compileModules,
  compileModulesDetailed,
  emitInitialHtml,
} from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const SOURCE = `
  function Panel() {
    return <section>
      <header><slot name="header">Fallback title</slot></header>
      <main><slot>Fallback body</slot></main>
      <footer><slot name="actions" /></footer>
    </section>;
  }

  function DialogFrame() {
    return <Panel>
      <slot name="title" slot="header">Default dialog</slot>
      <slot />
      <slot name="buttons" slot="actions" />
    </Panel>;
  }

  function SpreadFrame(props) {
    return <aside {...props}><slot /></aside>;
  }

  export function App() {
    let count = 1;
    let showExtra = false;
    return <div>
      <button id="increment" onClick={() => count++}>increment</button>
      <button id="toggle-extra" onClick={() => showExtra = !showExtra}>extra</button>
      <Panel>
        <h1 slot="header">Account {count}</h1>
        <p>Body {count}</p>
        <button slot="actions" class="action">Cancel</button>
        {showExtra && <i slot="actions" id="extra-action">Extra</i>}
        <button slot="actions" class="action">Save {count}</button>
      </Panel>
      <Panel />
      <DialogFrame>
        <h2 slot="title">Dialog {count}</h2>
        <p id="dialog-body">Question</p>
        <button slot="buttons" id="confirm">Confirm</button>
      </DialogFrame>
      <SpreadFrame id="spread-frame"><b>Spread body</b></SpreadFrame>
    </div>;
  }
`;

describe('R50 - component slots', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r50-component-slots.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('renders default, named, fallback, repeated, reactive, and forwarded slots', async () => {
    const { App } = await import('./fixtures/out/r50-component-slots.compiled.ts');
    document.body.appendChild(App('App', null));

    const sections = document.querySelectorAll('section');
    expect(sections).toHaveLength(3);
    expect(sections[0]!.querySelector('header')!.textContent).toBe('Account 1');
    expect(sections[0]!.querySelector('main')!.textContent).toBe('Body 1');
    expect(
      [...sections[0]!.querySelectorAll('.action')].map((node) => node.textContent),
    ).toEqual(['Cancel', 'Save 1']);
    expect(sections[1]!.querySelector('header')!.textContent).toBe('Fallback title');
    expect(sections[1]!.querySelector('main')!.textContent).toBe('Fallback body');
    expect(sections[2]!.querySelector('header')!.textContent).toBe('Dialog 1');
    expect(sections[2]!.querySelector('main')!.textContent).toBe('Question');
    expect(sections[2]!.querySelector('footer')!.textContent).toBe('Confirm');
    expect(document.querySelector('#spread-frame')!.textContent).toBe('Spread body');
    expect(document.querySelector('#spread-frame')!.getAttributeNames()).toEqual(['id']);
    expect(document.querySelector('#extra-action')).toBeNull();

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(sections[0]!.querySelector('header')!.textContent).toBe('Account 2');
    expect(sections[0]!.querySelector('main')!.textContent).toBe('Body 2');
    expect(sections[0]!.querySelectorAll('.action')[1]!.textContent).toBe('Save 2');
    expect(sections[2]!.querySelector('header')!.textContent).toBe('Dialog 2');
    document.querySelector<HTMLButtonElement>('#toggle-extra')!.click();
    expect(sections[0]!.querySelector('footer')!.textContent).toBe('CancelExtraSave 2');
  });

  it('links slot declarations across modules', () => {
    const output = compileModules({
      './Panel.tsx': `
        export function Panel() {
          return <article><slot name="title" /><slot /></article>;
        }
      `,
      './App.tsx': `
        import { Panel } from './Panel';
        export function App() {
          return <Panel><h1 slot="title">Title</h1><p>Body</p></Panel>;
        }
      `,
    });
    expect(output['./App.tsx']).toContain('createElement("h1")');
    expect(output['./App.tsx']).toContain('createElement("p")');
    expect(output['./App.tsx']).not.toContain('setAttribute("slot"');
  });

  it('uses projected slot content in initial HTML', () => {
    const runtimePath = '@memoized-dom/runtime';
    const output = compileModulesDetailed({
      './main.ts': `
        import { mount } from '${runtimePath}';
        import { App } from './App';
        mount('root', App);
      `,
      './Panel.tsx': `
        export function Panel() {
          return <section><slot name="title" /><slot /></section>;
        }
      `,
      './App.tsx': `
        import { Panel } from './Panel';
        export function App() {
          return <Panel><h1 slot="title">Title</h1><p>Body</p></Panel>;
        }
      `,
    }, { runtimePath, initialContent: true });
    expect(emitInitialHtml(output.initialRender)).toBe(
      '<section><h1>Title</h1><p>Body</p></section>',
    );
  });

  it('rejects ambiguous or invalid slot authoring', () => {
    expect(() => compile(`
      function Broken({ children }) { return <div><slot />{children}</div>; }
      export function App() { return <Broken>text</Broken>; }
    `)).toThrow(/cannot declare both <slot> and a children prop/);

    expect(() => compile(`
      function Panel() { return <section><slot name="known" /></section>; }
      export function App() { return <Panel><b slot="unknown">bad</b></Panel>; }
    `)).toThrow(/does not declare slot 'unknown'/);

    expect(() => compile(`
      function Panel() { return <section><slot name="title" /><slot name="title" /></section>; }
      export function App() { return <Panel />; }
    `)).toThrow(/declares slot 'title' more than once/);

    expect(() => compile(`
      function Panel() { return <section><slot name={which} /></section>; }
      export function App() { return <Panel />; }
    `)).toThrow(/slot name must be a non-empty static string literal/);

    expect(() => compile(`
      function Panel() { return <section><slot name="header" /></section>; }
      export function App() { return <Panel><p>no default</p></Panel>; }
    `)).toThrow(/does not declare a default slot/);

    expect(() => compile(`
      function Plain() { return <section>plain</section>; }
      export function App() { return <Plain><b slot="header">bad</b></Plain>; }
    `)).toThrow(/does not declare compiler slots/);

    expect(() => compile(`
      function Panel() { return <section><slot name="header" /><slot /></section>; }
      export function App() { return <Panel><div><b slot="header">buried</b></div></Panel>; }
    `)).toThrow(/must be a direct child/);

    expect(() => compile(`
      function Panel(props) { return <section><slot />{props['children']}</section>; }
      export function App() { return <Panel>bad</Panel>; }
    `)).toThrow(/cannot use both <slot> and props.children/);
  });

  it.each([
    `return <button onClick={()=>globalThis.show(props.children)}><slot/></button>`,
    `return <button onClick={()=>{const {children:content}=props;globalThis.show(content)}}><slot/></button>`,
    `const alias=props;return <button onClick={()=>globalThis.show(alias['children'])}><slot/></button>`,
    `function read(){return props.children}return <button onClick={read}><slot/></button>`,
  ])('rejects children reads captured by nested slot-component callbacks: %s', body => {
    expect(()=>compile(`export function Card(props){${body}}`)).toThrow(/cannot use both <slot> and props.children/);
  });

  it('rejects named-slot prop collisions inside nested callbacks', () => {
    expect(()=>compile(`export function Card(props){return <div><slot name="header"/>
      <button onClick={()=>{const {header}=props;globalThis.show(header)}}>Show</button></div>}`))
      .toThrow(/slot 'header' conflicts with props.header/);
  });

  it.each([
    `function read(props){return props.children}return <button onClick={()=>read({children:'local'})}><slot/></button>`,
    `function read(){const props={children:'local'};return props.children}return <button onClick={read}><slot/></button>`,
    `return <button onClick={()=>{try{throw {children:'local'}}catch(props){globalThis.show(props.children)}}}><slot/></button>`,
  ])('allows unrelated shadowed props inside slot-component callbacks: %s', body => {
    expect(()=>compile(`export function Card(props){${body}}`)).not.toThrow();
  });
});
