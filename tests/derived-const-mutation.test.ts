import { afterEach, expect, it } from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileModules} from '@memoized-dom/compiler';
import {registeredIds,unregisterSubtree,setScheduler,resetScheduler} from '@memoized-dom/runtime/testing';

afterEach(()=>{
  for(const id of registeredIds())unregisterSubtree(id);
  resetScheduler();document.body.replaceChildren();
});

const MAIN="import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);";

async function mountApp(name:string,app:string){
  const directory=join(import.meta.dirname,'fixtures/out/derived-const-mutation',name);
  mkdirSync(directory,{recursive:true});
  const output=compileModules({'./main.ts':MAIN,'./App.tsx':app},{runtimePath:'@memoized-dom/runtime/testing'});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    out:()=>document.querySelector('#out')!.textContent,
  };
}

// The editor's tag list: a const derived from a prop, then edited in place.
const EDITOR=(declaration:string)=>`
  function Tags({ article }: { article: { tags: string[] } }) {
    ${declaration}
    return <div><output id="out">{tags.join(',')}</output>
      <button id="add" onClick={() => { tags.push('new'); }} />
      <button id="drop" onClick={() => { tags.splice(0, 1); }} /></div>;
  }
  export function App() { let article = { tags: ['a', 'b'] };
    return <main><button id="load" onClick={() => { article = { tags: ['x'] }; }} /><Tags article={article} /></main>; }`;

// The Conduit editor: a named helper edits the copy and resets a draft.
it('a named handler edits a derived copy and writes other local state', async () => {
  const app=await mountApp('named-handler',`
    function Tags({ article }: { article: { tags: string[] } | null }) {
      const tags = article === null ? [] : [...article.tags];
      let draft = 'new';
      function addTag() { const name = draft.trim(); if (name !== '' && !tags.includes(name)) tags.push(name); draft = ''; }
      return <div><output id="out">{tags.join(',')}</output><i id="draft">{draft}</i>
        <ul>{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
        <button id="add" onClick={addTag} /></div>;
    }
    export function App() { let article = { tags: ['a'] }; return <main><Tags article={article} /></main>; }`);
  expect(app.out()).toBe('a');
  app.click('add');
  expect(app.out()).toBe('a,new');
  expect([...document.querySelectorAll('li')].map(li => li.textContent)).toEqual(['a', 'new']);
  expect(document.querySelector('#draft')!.textContent).toBe('');
});

it.each([
  ['a copied array', 'const tags = [...article.tags];'],
  ['a conditional copy', 'const tags = article === null ? [] : [...article.tags];'],
])('a const derived from a prop as %s can be edited in place', async (name, declaration) => {
  const app=await mountApp(name.replace(/ /g,'-'),EDITOR(declaration));
  expect(app.out()).toBe('a,b');
  app.click('add');
  expect(app.out()).toBe('a,b,new');
  app.click('drop');
  expect(app.out()).toBe('b,new');
  // A new source value re-derives the copy, as a const derivation does.
  app.click('load');
  expect(app.out()).toBe('x');
  app.click('add');
  expect(app.out()).toBe('x,new');
});

// Browsers batch commits into a frame: the edit and the draft reset render together.
it('keeps an edited copy when the commit is batched, as in a browser', async () => {
  const app=await mountApp('batched',`
    function Tags({ article }: { article: { tags: string[] } | null }) {
      const tags = article === null ? [] : [...article.tags];
      let draft = 'new';
      function addTag() { const name = draft.trim(); if (name !== '' && !tags.includes(name)) tags.push(name); draft = ''; }
      return <div><output id="out">{tags.join(',')}</output><ul>{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
        <button id="add" onClick={addTag} /></div>;
    }
    export function App() { let article = null; return <main><Tags article={article} /></main>; }`);
  setScheduler(run => queueMicrotask(run));
  app.click('add');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(app.out()).toBe('new');
  expect([...document.querySelectorAll('li')].map(li => li.textContent)).toEqual(['new']);
});

// The Conduit editor shape: a keydown handler inside a form with other local state.
it('keeps a copy edited from a keydown handler in a selective component', async () => {
  const app=await mountApp('editor-shape',`
    function Form({ article }: { article: { tags: string[]; body: string } | null }) {
      const tags = article === null ? [] : [...article.tags];
      let draftTag = '';
      let body = article?.body ?? '';
      let preview = false;
      let saved: string[] = [];
      const form = $forms((_fields: FormData) => { saved = [...tags]; return Promise.resolve(saved); });
      function addTag(event: KeyboardEvent) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const name = draftTag.trim().toLowerCase();
        if (name !== '' && !tags.includes(name)) tags.push(name);
        draftTag = '';
      }
      return <form onSubmit={form.submit}>
        <button id="preview" type="button" onClick={() => preview = !preview}>{preview ? 'p' : 'w'}</button>
        <textarea hidden={preview} value={body} onInput={event => body = event.currentTarget.value}></textarea>
        <input id="tag" value={draftTag} onInput={event => draftTag = event.currentTarget.value} onKeyDown={addTag} />
        <output id="out">{tags.join(',')}</output>
        <ul>{tags.map(name => <li key={name}><button type="button" onClick={() => tags.splice(tags.indexOf(name), 1)}>x</button> {name}</li>)}</ul>
      </form>;
    }
    export function App() { return <main><Form article={null} /></main>; }`);
  const input = document.querySelector<HTMLInputElement>('#tag')!;
  input.value = 'flow'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(app.out()).toBe('flow');
  expect([...document.querySelectorAll('li')].map(li => li.textContent)).toEqual(['x flow']);
  expect(input.value).toBe('');
});

// Later renders for unrelated state keep the edit; only a new source re-derives.
it('keeps an edited copy across unrelated renders until its source is replaced', async () => {
  const app=await mountApp('unrelated-renders',`
    function Tags({ article }: { article: { tags: string[] } }) {
      const tags = [...article.tags];
      let count = 0;
      return <div><output id="out">{tags.join(',')}</output><i id="count">{count}</i>
        <button id="add" onClick={() => { tags.push('new'); }} />
        <button id="other" onClick={() => { count++; }} /></div>;
    }
    export function App() { let article = { tags: ['a'] };
      return <main><button id="load" onClick={() => { article = { tags: ['x'] }; }} /><Tags article={article} /></main>; }`);
  app.click('add');
  app.click('other');
  app.click('other');
  expect(app.out()).toBe('a,new');
  expect(document.querySelector('#count')!.textContent).toBe('2');
  app.click('load');
  expect(app.out()).toBe('x');
});
