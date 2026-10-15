import { describe, expect, it } from 'bun:test';
import { extractServerPages } from '../packages/compiler/src/server-pages';
import { compileModules } from '../packages/compiler/src/linker';

const options = { moduleId: './server/functions/board.tsx' };

describe('server page boundary extraction', () => {
  it('keeps async handlers separate from ordinary JSX component compilation', () => {
    const result = extractServerPages(`import { page } from '@memoized-dom/server';
      import { Board } from '../components/Board';
      import { database } from '../database';
      export async function getBoard(id: string) {
        const notes = await database.all(id);
        return page(<Board expeditionId={id} notes={notes} />);
      }`, options);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.captures).toEqual(['id', 'notes']);
    expect(result.source).toContain('await database.all(id)');
    expect(result.source).not.toContain('<Board');
    expect(result.source).not.toContain('markDirty');
    expect(result.componentSource).toContain('<Board');
    expect(result.componentSource).not.toContain('database');
    expect(result.componentSource).not.toContain('getBoard');
    const linked = compileModules({
      './page.tsx': result.componentSource,
      './components/Board.tsx': `export function Board({ expeditionId, notes }) {
        return <section><h1>{expeditionId}</h1><ul>{notes.map(note=><li key={note.id}>{note.text}</li>)}</ul></section>;
      }`,
    }, { resolveImport: specifier => specifier === '../components/Board' ? './components/Board.tsx' : undefined });
    expect(linked['./page.tsx']).not.toContain('<Board');
  });

  it('recognizes imported aliases and host-resolved re-exports, not shadowed names', () => {
    const source = `import { page as view, define } from '../define';
      export async function get(name) { return view(<h1>{name}</h1>); }
      function other(view) { return view('ordinary'); }`;
    expect(extractServerPages(source, options).pages).toHaveLength(0);
    const result = extractServerPages(source, { ...options, pageImports: [{ module: '../define' }] });
    expect(result.pages).toHaveLength(1);
    expect(result.source).toContain("view('ordinary')");
    expect(result.source).toContain('define');
  });

  it('captures enclosing values but not lexical row bindings or property names', () => {
    const result = extractServerPages(`import {page} from '@memoized-dom/server';
      export async function make(notes, suffix) { return page(<ul>{notes.map(note => <li key={note.id}>{note.text}{suffix}</li>)}</ul>); }`, options);
    expect(result.pages[0]?.captures).toEqual(['notes', 'suffix']);
    expect(result.componentSource).toContain('note.text');
  });

  it('captures module values and preserves multiple return branches for POST as well as GET', () => {
    const result = extractServerPages(`import {page} from '@memoized-dom/server';
      const reason='Denied';export async function post(user, notes) {
        if (!user) return page(<p>{reason}</p>);
        return page(<section>{notes.length}</section>);
      }`, options);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.captures).toEqual(['reason']);
    expect(result.pages[1]?.captures).toEqual(['notes']);
    expect(result.pages[0]?.id).not.toBe(result.pages[1]?.id);
    expect(result.source).toContain('if (!user)');
  });

  it('preserves interaction syntax for a later binding product rather than dropping it', () => {
    const result = extractServerPages(`import {page} from '@memoized-dom/server';
      export async function make(id) { return page(<button onClick={()=>console.log(id)}>Open</button>); }`, options);
    expect(result.componentSource).toContain('onClick');
    expect(result.pages[0]?.captures).toEqual(['id']);
  });

  it('allocates hygienic companion imports and leaves unrelated modules byte-identical', () => {
    const untouched = `export function page(value) { return value; } page('not framework JSX');`;
    expect(extractServerPages(untouched, options)).toEqual({ source: untouched, componentSource: '', pages: [] });
    const result = extractServerPages(`import {page} from '@memoized-dom/server';
      const MemoizedServerPage0=1;const __mmdCreateServerPage=2;
      export async function make(){return page(<p>{MemoizedServerPage0+__mmdCreateServerPage}</p>);}`, options);
    expect(result.pages[0]?.component).toBe('MemoizedServerPage0_');
    expect(result.source).toContain('createServerPage as __mmdCreateServerPage_');
  });

  it('rejects invalid inputs, escaping helpers, and currently unlinked local component tags', () => {
    for (const body of [`page('html')`, 'page(<p/>, {})', 'page()']) {
      expect(() => extractServerPages(`import {page} from '@memoized-dom/server';export async function make(){return ${body};}`, options))
        .toThrow('requires one JSX element or fragment');
    }
    expect(() => extractServerPages(`import {page} from '@memoized-dom/server';
      const other=page;export async function make(){return page(<p/>);}`, options)).toThrow('cannot escape');
    expect(() => extractServerPages(`import {page} from '@memoized-dom/server';const other=page;`, options)).toThrow('cannot escape');
    expect(() => extractServerPages(`import {page} from '@memoized-dom/server';
      export async function make(){return page(<div>{page(<p/>)}</div>);}`, options)).toThrow('nested page()');
    expect(() => extractServerPages(`import {page} from '@memoized-dom/server';
      function Local(){return <p/>;}export async function make(){return page(<Local/>);}`, options)).toThrow('must currently be imported');
  });
});
