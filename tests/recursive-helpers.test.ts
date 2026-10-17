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
const TREE="type Node={id:number;label:string;kids:Node[]};";

async function run(name:string,modules:Record<string,string>,clicks:string[]){
  const output=compileModules({'./main.ts':MAIN,...modules},{runtimePath:'@memoized-dom/runtime/testing'});
  const directory=join(import.meta.dirname,'fixtures/out/recursive-helpers',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  const seen=[document.querySelector('#out')!.textContent];
  for(const id of clicks){
    document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
    seen.push(document.querySelector('#out')!.textContent);
  }
  return seen;
}

const CONTROLS=`<button id="add" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}/>
  <button id="rename" onClick={()=>{root.kids[0].label='A';}}/>`;

it('derives from a recursive module helper',async()=>{
  expect(await run('module-helper',{'./App.tsx':`${TREE}
    function flatten(node:Node,out:Node[]=[]):Node[]{out.push(node);for(const kid of node.kids)flatten(kid,out);return out;}
    export function App(){const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};const rows=flatten(root);
      return <main><output id="out">{rows.map(r=><i key={r.id}>{r.label}</i>)}</output>${CONTROLS}</main>;}`,
  },['add','rename'])).toEqual(['ra','rab','rAb']);
});

it('derives from a recursive helper declared inside the component',async()=>{
  expect(await run('local-helper',{'./App.tsx':`${TREE}
    export function App(){const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      function count(node:Node):number{let total=1;for(const kid of node.kids)total+=count(kid);return total;}
      const size=count(root);
      return <main><output id="out">{size}</output>${CONTROLS}</main>;}`,
  },['add'])).toEqual(['2','3']);
});

it('derives from mutually recursive module helpers called in either order',async()=>{
  const helpers=`${TREE}
    function labels(node:Node):string{return node.label+kids(node);}
    function kids(node:Node):string{return node.kids.map(labels).join('');}`;
  for(const entry of ['labels','kids']){
    unregisterSubtree('App');document.body.replaceChildren();
    expect(await run(`mutual-${entry}`,{'./App.tsx':`${helpers}
      export function App(){const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
        const text=${entry==='labels'?'labels(root)':"'r'+kids(root)"};
        return <main><output id="out">{text}</output>${CONTROLS}</main>;}`,
    },['add'])).toEqual(['ra','rab']);
  }
});

it('keeps a recursive helper that writes state routed to its readers',async()=>{
  expect(await run('recursive-writer',{
    './tree.ts':`${TREE.replace('type','export type')}export const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      function shout(node:Node){node.label=node.label.toUpperCase();node.kids.forEach(shout);}
      export function shoutAll(){shout(root);}`,
    './Label.tsx':"import {root} from './tree';export function Label(){return <output id=\"out\">{root.label}{root.kids[0].label}</output>;}",
    './App.tsx':"import {shoutAll} from './tree';import {Label} from './Label';export function App(){return <main><Label/><button id=\"go\" onClick={shoutAll}/></main>;}",
  },['go'])).toEqual(['ra','RA']);
});
