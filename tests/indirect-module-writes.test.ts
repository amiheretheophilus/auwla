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

/** The writer and the reader are different components, so only routed writes can update the reader. */
async function renameAndRead(name:string,doc:string,imports:string,handler:string){
  const output=compileModules({
    './main.ts':MAIN,'./doc.ts':doc,
    './Label.tsx':"import {root} from './doc';export function Label(){return <output id=\"out\">{root.kids[0].label}</output>;}",
    './App.tsx':`import {${imports}} from './doc';import {Label} from './Label';
      export function App(){return <main><Label/><button id="a" onClick={${handler}}>r</button></main>;}`,
  },{runtimePath:'@memoized-dom/runtime/testing'});
  const directory=join(import.meta.dirname,'fixtures/out/indirect-module-writes',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  const before=document.querySelector('#out')!.textContent;
  document.querySelector<HTMLButtonElement>('#a')!.click();
  return [before,document.querySelector('#out')!.textContent];
}

const LITERAL="export const root:any={label:'r',kids:[{label:'a',kids:[]}]};";
const BUILT="function build():any{return {label:'r',kids:[{label:'a',kids:[]}]};}export const root:any=build();";
const DEEPEST="function deepest(){let node=root;while(node.kids.length>0)node=node.kids[node.kids.length-1];return node;}";

it.each([
  ['helper result write',`${DEEPEST}export function rename(){deepest().label='A';}`,'rename','rename'],
  ['helper result through a local',`${DEEPEST}export function rename(){const node=deepest();node.label='A';}`,'rename','rename'],
  ['helper result written in a handler',`export ${DEEPEST}`,'deepest',"()=>{deepest().label='A';}"],
  ['find() result in a helper',"export function rename(){root.kids.find((k:any)=>k.label==='a').label='A';}",'rename','rename'],
])('routes writes through returned objects to other readers (%s)',async(label,body,imports,handler)=>{
  expect(await renameAndRead(`result-${label.replaceAll(' ','-')}`,LITERAL+body,imports,handler)).toEqual(['a','A']);
});

it.each([
  ['written by an importer','','root',"()=>{root.kids[0].label='A';}"],
  ['written through a local alias',"export function rename(){const n=root.kids[0];n.label='A';}",'rename','rename'],
  ['written by a helper parameter',"function relabel(n:any){n.label='A';}export function rename(){relabel(root.kids[0]);}",'rename','rename'],
  ['written through a helper result',`${DEEPEST}export function rename(){deepest().label='A';}`,'rename','rename'],
])('tracks module objects built by a call like literals (%s)',async(label,body,imports,handler)=>{
  expect(await renameAndRead(`built-${label.replaceAll(' ','-')}`,BUILT+body,imports,handler)).toEqual(['a','A']);
});

it('still treats a call that reads module state as a derivation',async()=>{
  const output=compileModules({
    './main.ts':MAIN,
    './App.tsx':`let count=1;function double(n:number){return {value:n*2};}const doubled=double(count);
      export function App(){return <button onClick={()=>{count++;}}>{doubled.value}</button>;}`,
  },{runtimePath:'@memoized-dom/runtime/testing'});
  expect(output['./App.tsx']).toContain('$computed');
  const directory=join(import.meta.dirname,'fixtures/out/indirect-module-writes','derivation');
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  const button=document.querySelector('button')!;
  expect(button.textContent).toBe('2');
  button.click();
  expect(button.textContent).toBe('4');
});
