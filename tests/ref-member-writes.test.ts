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
  const directory=join(import.meta.dirname,'fixtures/out/ref-member-writes',name);
  mkdirSync(directory,{recursive:true});
  const output=compileModules({'./main.ts':MAIN,'./App.tsx':app},{runtimePath:'@memoized-dom/runtime/testing'});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    html:()=>document.querySelector('#host')!.innerHTML,
  };
}

// An effect pushing HTML into a ref'd node (markdown, a chart, a widget) is
// imperative DOM work: the node is not state, so the effect must not re-run itself.
it.each([
  ['let ref', `let host: HTMLDivElement | undefined;`, 'host', 'ref={host}'],
  ['member ref', `const nodes: { host?: HTMLDivElement } = {};`, 'nodes.host', 'ref={nodes.host}'],
])('an effect writing through a %s re-runs only when its inputs change', async (name, declaration, target, ref) => {
  const app=await mountApp(name.replace(' ','-'),`
    function Markdown({ source }: { source: string }) {
      ${declaration}
      $effect(() => { if (${target} !== undefined) ${target}.innerHTML = '<em>' + source + '</em>'; });
      return <div id="host" ${ref}></div>;
    }
    export function App() { let text = 'one';
      return <main><button id="next" onClick={() => { text = 'two'; }} /><Markdown source={text} /></main>; }`);
  expect(app.html()).toBe('<em>one</em>');
  app.click('next');
  expect(app.html()).toBe('<em>two</em>');
});

it('an effect rendering through a module helper into a let ref (a markdown view)', async () => {
  const app=await mountApp('helper',`
    const render = (source: string) => '<p>' + source.toUpperCase() + '</p>';
    function Markdown({ source }: { source: string }) {
      let host: HTMLDivElement | undefined;
      $effect(() => { if (host !== undefined) host.innerHTML = render(source); });
      return <div id="host" ref={host}></div>;
    }
    export function App() { let text = 'one';
      return <main><button id="next" onClick={() => { text = 'two'; }} /><Markdown source={text} /></main>; }`);
  expect(app.html()).toBe('<p>ONE</p>');
  app.click('next');
  expect(app.html()).toBe('<p>TWO</p>');
});

it('a method call through a member ref is DOM work, not a state write', async () => {
  const app=await mountApp('method',`
    export function App() { let on = false; const nodes: { host?: HTMLDivElement } = {};
      $effect(() => { nodes.host?.classList.toggle('on', on); });
      return <main><button id="next" onClick={() => { on = !on; }} /><div id="host" ref={nodes.host}>x</div></main>; }`);
  expect(document.querySelector('#host')!.className).toBe('');
  app.click('next');
  expect(document.querySelector('#host')!.className).toBe('on');
});
