/**
 * Server page extraction and input projection (`pages.ts`, `page-inputs.ts`). The extraction
 * cases are the old compiler's (`tests/server-pages-extraction.test.ts`), on this compiler's
 * generated modules.
 */
import { describe, expect, it } from 'bun:test';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { pageInputPaths } from './page-inputs';
import { extractPages, type PageImport } from './pages';

const PATH = './server/functions/board.tsx';
const MODULE = './.memoized/pages/board.tsx';
const framework: PageImport = (source, imported) => source === '@memoized-dom/server' && imported === 'page';
const extract = (text: string, isPage: PageImport = framework) => extractPages(PATH, text, MODULE, isPage);

describe('server page extraction', () => {
  it('moves the JSX into a page module and keeps the handler as backend code', () => {
    const result = extract(`import { page } from '@memoized-dom/server';
      import { Board } from '../components/Board';
      import { database } from '../database';
      export async function getBoard(id: string) {
        const notes = await database.all(id);
        return page(<Board expeditionId={id} notes={notes} />);
      }`)!;
    expect(result.pages).toEqual([{ id: 'server/functions/board.tsx#Page0', component: 'Page0', captures: ['id', 'notes'] }]);
    const handler = result.handler(new Map());
    expect(handler).toContain('await database.all(id)');
    expect(handler).not.toContain('<Board');
    expect(handler).toContain('__mmd_page("server/functions/board.tsx#Page0", __mmd_Page0, [id, notes], null)');
    expect(handler).toContain(`import { Page0 as __mmd_Page0 } from "../../.memoized/pages/board"`);
    // The page module imports the component from its own folder, and nothing of the handler's.
    expect(result.module).toContain(`import { Board } from "../../server/components/Board";`);
    expect(result.module).toContain('const [id, notes] = inputs;');
    expect(result.module).not.toContain('database');
    expect(result.module).not.toContain('getBoard');
  });

  it('recognizes an alias the application says is page, and not a shadowing parameter', () => {
    const source = `import { page as view, define } from '../define';
      export async function get(name) { return view(<h1>{name}</h1>); }
      function other(view) { return view('ordinary'); }`;
    expect(extract(source)).toBeNull();
    const result = extract(source, (from, imported) => from === '../define' && imported === 'page')!;
    expect(result.pages).toHaveLength(1);
    const handler = result.handler(new Map());
    expect(handler).toContain("view('ordinary')");
    expect(handler).toContain('define');
  });

  it('captures enclosing values, not row bindings or property names', () => {
    const result = extract(`import {page} from '@memoized-dom/server';
      export async function make(notes, suffix) { return page(<ul>{notes.map(note => <li key={note.id}>{note.text}{suffix}</li>)}</ul>); }`)!;
    expect(result.pages[0]?.captures).toEqual(['notes', 'suffix']);
    expect(result.module).toContain('note.text');
  });

  it('captures module values and keeps each return branch', () => {
    const result = extract(`import {page} from '@memoized-dom/server';
      const reason='Denied';export async function post(user, notes) {
        if (!user) return page(<p>{reason}</p>);
        return page(<section>{notes.length}</section>);
      }`)!;
    expect(result.pages.map((page) => page.captures)).toEqual([['reason'], ['notes']]);
    expect(result.pages[0]?.id).not.toBe(result.pages[1]?.id);
    expect(result.handler(new Map())).toContain('if (!user)');
  });

  it('keeps event handlers for the browser binding', () => {
    const result = extract(`import {page} from '@memoized-dom/server';
      export async function make(id) { return page(<button onClick={()=>console.log(id)}>Open</button>); }`)!;
    expect(result.module).toContain('onClick');
    expect(result.pages[0]?.captures).toEqual(['id']);
  });

  it('leaves a module without the framework page alone, and avoids authored names', () => {
    expect(extract(`export function page(value) { return value; } page('not framework JSX');`)).toBeNull();
    const result = extract(`import {page} from '@memoized-dom/server';
      const __mmd_Page0=1;const __mmd_page=2;
      export async function make(){return page(<p>{__mmd_Page0+__mmd_page}</p>);}`)!;
    const handler = result.handler(new Map());
    expect(handler).toContain('createComponentPage as __mmd_page_');
    expect(handler).toContain('Page0 as __mmd_Page0_');
  });

  it("writes a source language's handler in its authored text, at the call's authored place", () => {
    // A toy language: the authored module starts with a line of its own, which its TSX drops.
    const tsx = `import { page } from '@memoized-dom/server';
      export async function make(name) { return page(<h1>{name}</h1>); }`;
    const authored = `@language toy\n${tsx}`;
    const shift = '@language toy\n'.length;
    const result = extractPages('./server/functions/board.auwla', tsx, MODULE, framework, {
      text: authored,
      origin: { original: (offset) => offset + shift },
    })!;
    const handler = result.handler(new Map());
    expect(handler.startsWith('@language toy\n')).toBe(true);
    expect(handler).toContain('return __mmd_page("server/functions/board.auwla#Page0", __mmd_Page0, [name], null); }');
    // The page module is TSX.
    expect(result.module).toContain('return (<h1>{name}</h1>);');
  });

  it('rejects other arguments, an escaping page and nested or local component tags', () => {
    for (const body of [`page('html')`, 'page(<p/>, {})', 'page()']) {
      expect(() => extract(`import {page} from '@memoized-dom/server';export async function make(){return ${body};}`))
        .toThrow('requires one JSX element or fragment');
    }
    expect(() => extract(`import {page} from '@memoized-dom/server';
      const other=page;export async function make(){return page(<p/>);}`)).toThrow('cannot escape');
    expect(() => extract(`import {page} from '@memoized-dom/server';const other=page;`)).toThrow('cannot escape');
    expect(() => extract(`import {page} from '@memoized-dom/server';
      export async function make(){return page(<div>{page(<p/>)}</div>);}`)).toThrow('nested page()');
    expect(() => extract(`import {page} from '@memoized-dom/server';
      function Local(){return <p/>;}export async function make(){return page(<Local/>);}`)).toThrow('must currently be imported');
  });
});

describe('page input projection', () => {
  const programs = (files: Record<string, string>) => {
    const parsed = new Map(Object.entries(files).map(([path, text]) => [path, parse(text, { lang: 'tsx', sourceType: 'module' }).program.body as Node[]]));
    return {
      program: (path: string) => parsed.get(path),
      resolve: (specifier: string) => (specifier === './Board' ? './Board.tsx' : undefined),
    };
  };

  it('sends only the paths the components read, through props, defaults and handlers', () => {
    const sources = programs({
      './page.tsx': `import { Board } from './Board';
        export function Page0(inputs) { const [count, user, subtitle] = inputs; return (<Board count={count} user={user} subtitle={subtitle} />); }`,
      './Board.tsx': `export function Board({ count, user, subtitle = 'No subtitle' }) {
        let hint = ''; function reveal() { hint = user.hint; }
        return <section><h1>{user.name}</h1><small>{subtitle}</small><p>{count}</p><button onClick={reveal}>Reveal</button><p>{hint}</p></section>;
      }`,
    });
    const paths = pageInputPaths(sources, './page.tsx', 'Page0', 3).map((path) => path.join('.'));
    expect(paths.sort()).toEqual(['0', '1.hint', '1.name', '2']);
  });

  it('follows rows through filter and find, so a later loop over them still gets its fields', () => {
    const sources = programs({
      './page.tsx': `export function Page0(inputs) { const [project] = inputs;
        const visible = project.tasks.filter((task) => !task.done);
        const first = project.tasks.find((task) => task.id === 1);
        return (<section><h1>{first.title}</h1><ul>{visible.map((task) => <li>{task.title}</li>)}</ul><p>{visible.length}</p></section>); }`,
    });
    const paths = pageInputPaths(sources, './page.tsx', 'Page0', 1).map((path) => path.join('.'));
    expect(paths.sort()).toEqual(['0.tasks.*.done', '0.tasks.*.id', '0.tasks.*.title', '0.tasks.length']);
  });

  it("follows rows through Array.from's mapper, which an .auwla loop in markup becomes", () => {
    const sources = programs({
      './page.tsx': `export function Page0(inputs) { const [project] = inputs;
        const visible = project.tasks.filter((task) => !task.done);
        return (<ul>{Array.from(visible, (task) => <li key={task.id}>{task.title}</li>)}</ul>); }`,
    });
    const paths = pageInputPaths(sources, './page.tsx', 'Page0', 1).map((path) => path.join('.'));
    expect(paths.sort()).toEqual(['0.tasks.*.done', '0.tasks.*.id', '0.tasks.*.title']);
  });

  it('follows rows with a wildcard and sends a value whole where it reaches an unknown call', () => {
    const sources = programs({
      './page.tsx': `export function Page0(inputs) { const [notes, user] = inputs;
        return (<ul data-user={format(user)}>{notes.map((note) => <li>{note.text}</li>)}</ul>); }`,
    });
    const paths = pageInputPaths(sources, './page.tsx', 'Page0', 2).map((path) => path.join('.'));
    expect(paths.sort()).toEqual(['0.*.text', '1']);
  });
});
