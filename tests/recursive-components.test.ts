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
const compile=(modules:Record<string,string>)=>
  compileModules({'./main.ts':MAIN,...modules},{runtimePath:'@memoized-dom/runtime/testing'});

async function mountApp(name:string,modules:Record<string,string>){
  const output=compile(modules);
  const directory=join(import.meta.dirname,'fixtures/out/recursive-components',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    output,
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    out:()=>document.querySelector('#out')!.textContent,
  };
}

const TREE="type Node={id:number;label:string;kids:Node[]};";
const ROOT="{id:0,label:'r',kids:[{id:1,label:'a',kids:[{id:2,label:'b',kids:[]}]}]}";

it('renders a self-recursive component and follows deep edits to module state',async()=>{
  const app=await mountApp('module-state',{
    './outline.ts':`export ${TREE}export const root:Node=${ROOT};
      export function rename(){root.kids[0].kids[0].label='B';}
      export function add(){root.kids[0].kids[0].kids.push({id:3,label:'c',kids:[]});}
      export function remove(){root.kids[0].kids.splice(0,1);}`,
    './Tree.tsx':`import type {Node} from './outline';
      export function Tree({node}:{node:Node}){return <span>{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    './App.tsx':`import {Tree} from './Tree';import {root,rename,add,remove} from './outline';
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="rename" onClick={rename}/><button id="add" onClick={add}/><button id="remove" onClick={remove}/></main>;}`,
  });
  expect(app.out()).toBe('rab');
  const deepest=document.querySelector('output span span span');
  app.click('rename');expect(app.out()).toBe('raB');
  expect(document.querySelector('output span span span')).toBe(deepest);
  app.click('add');expect(app.out()).toBe('raBc');
  app.click('remove');expect(app.out()).toBe('ra');
});

it('routes shared state read at every depth through a depth wildcard',async()=>{
  const app=await mountApp('wildcard-readers',{
    './selection.ts':'export const selection={id:-1};export function select(id:number){selection.id=id;}',
    './Tree.tsx':`import {selection} from './selection';${TREE}
      export function Tree({node}:{node:Node}){return <span>{selection.id===node.id?'*':''}{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    './App.tsx':`import {Tree} from './Tree';import {select} from './selection';const root=${ROOT};
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="deep" onClick={()=>select(2)}/><button id="top" onClick={()=>select(0)}/></main>;}`,
  });
  expect(app.output['./Tree.tsx']).toContain('"./selection.ts#selection.id": ["App/Tree", "App/Tree/**"]');
  expect(app.out()).toBe('rab');
  app.click('deep');expect(app.out()).toBe('ra*b');
  app.click('top');expect(app.out()).toBe('*rab');
});

it('lets each recursive instance write its own node and keep its own state',async()=>{
  const app=await mountApp('instance-state',{
    './Tree.tsx':`${TREE}export function Tree({node}:{node:Node}){let open=true;
      return <span>{node.label}
        <button id={'up'+node.id} onClick={()=>{node.label=node.label.toUpperCase();}}/>
        <button id={'fold'+node.id} onClick={()=>{open=!open;}}/>
        {open ? <i>{node.kids.map(k=><Tree key={k.id} node={k}/>)}</i> : null}</span>;}`,
    './App.tsx':`import {Tree} from './Tree';const root=${ROOT};
      export function App(){return <main><output id="out"><Tree node={root}/></output></main>;}`,
  });
  app.click('up2');expect(app.out()).toBe('raB');
  app.click('fold1');expect(app.out()).toBe('ra');
  app.click('up0');expect(app.out()).toBe('Ra');
  app.click('fold1');expect(app.out()).toBe('RaB');
});

it('links mutual recursion across modules',async()=>{
  const app=await mountApp('mutual',{
    './Folder.tsx':"import {Children} from './Children';export function Folder({node}:{node:any}){return <span>{node.label}<Children node={node}/></span>;}",
    './Children.tsx':"import {Folder} from './Folder';export function Children({node}:{node:any}){return <i>{node.kids.map((k:any)=><Folder key={k.id} node={k}/>)}</i>;}",
    './data.ts':"export const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[] as any[]}]};export function add(){root.kids[0].kids.push({id:2,label:'b',kids:[]});}",
    './App.tsx':`import {Folder} from './Folder';import {root,add} from './data';
      export function App(){return <main><output id="out"><Folder node={root}/></output><button id="add" onClick={add}/></main>;}`,
  });
  expect(app.out()).toBe('ra');
  app.click('add');expect(app.out()).toBe('rab');
});

it('compiles a recursive component declared beside its caller',async()=>{
  const app=await mountApp('same-module',{
    './App.tsx':`${TREE}const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      function Tree({node}:{node:Node}){return <span>{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="add" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}/></main>;}`,
  });
  expect(app.out()).toBe('ra');
  app.click('add');expect(app.out()).toBe('rab');
});

it('still rejects recursion that nothing can stop',()=>{
  expect(()=>compile({'./App.tsx':'function Tree(){return <div><Tree/></div>;}export function App(){return <Tree/>;}'}))
    .toThrow(/recursive component 'Tree' renders itself unconditionally/);
  expect(()=>compile({
    './App.tsx':"import {A} from './a';export function App(){return <A/>;}",
    './a.tsx':"import {B} from './b';export function A(){return <main><B/></main>;}",
    './b.tsx':"import {A} from './a';export function B(){return <main><A/></main>;}",
  })).toThrow(/renders itself unconditionally/);
});
