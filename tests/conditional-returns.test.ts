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

async function mountApp(name:string,child:string){
  const app=`${child}
    export function App(){let items=['a'];let open=true;
      return <main><button id="toggle" onClick={()=>{open=!open;}}/>
        <button id="clear" onClick={()=>{items=[];}}/>
        <div id="out"><Child items={items} open={open}/></div></main>;}`;
  const directory=join(import.meta.dirname,'fixtures/out/conditional-returns',name);
  mkdirSync(directory,{recursive:true});
  const output=compileModules({'./main.ts':MAIN,'./App.tsx':app},{runtimePath:'@memoized-dom/runtime/testing'});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    out:()=>document.querySelector('#out')!.innerHTML.replace(/<!--[^>]*-->/g,''),
  };
}

// The React habit: a component returns its conditional directly.
it.each([
  ['ternary', `function Child({items,open}:{items:string[];open:boolean}){
    return open ? <ul>{items.map(item=><li key={item}>{item}</li>)}</ul> : <p>closed</p>;}`],
  ['arrow body', `const Child=({items,open}:{items:string[];open:boolean})=>
    open ? <ul>{items.map(item=><li key={item}>{item}</li>)}</ul> : <p>closed</p>;`],
  ['nested ternary', `function Child({items,open}:{items:string[];open:boolean}){
    return !open ? <p>closed</p> : items.length === 0 ? null : <ul>{items.map(item=><li key={item}>{item}</li>)}</ul>;}`],
])('a component returning a bare %s renders and updates', async (name, child) => {
  const app=await mountApp(name.replace(/ /g,'-'),child);
  expect(app.out()).toBe('<ul><li>a</li></ul>');
  app.click('toggle');
  expect(app.out()).toBe('<p>closed</p>');
  app.click('toggle');
  expect(app.out()).toBe('<ul><li>a</li></ul>');
  if(name==='nested ternary'){app.click('clear');expect(app.out()).toBe('');}
});

it('a component returning cond && <jsx> renders nothing when false', async () => {
  const app=await mountApp('and',`function Child({items,open}:{items:string[];open:boolean}){ return open && <b>{items.length ? "open" : "open"}</b>; }`);
  expect(app.out()).toBe('<b>open</b>');
  app.click('toggle');
  expect(app.out()).toBe('');
});
