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

/** The writer and the reader are different components, so only routed writes update the reader. */
async function clickAndRead(name:string,modules:Record<string,string>,clicks:number){
  const directory=join(import.meta.dirname,'fixtures/out/namespace-and-getter-reads',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(compile(modules)))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  const seen=[document.querySelector('#out')!.textContent];
  for(let i=0;i<clicks;i++){
    document.querySelector<HTMLButtonElement>('#a')!.click();
    seen.push(document.querySelector('#out')!.textContent);
  }
  return seen;
}

const app=(writer:string,handler:string)=>`${writer}import {Reader} from './Reader';
  export function App(){return <main><Reader/><button id="a" onClick={${handler}}>go</button></main>;}`;

it.each([
  ['writer', "export const cart={items:[] as string[]};",
    "import {cart} from './store';export function Reader(){return <output id=\"out\">{cart.items.length}</output>;}",
    app("import * as store from './store';", "()=>store.cart.items.push('x')")],
  ['reader', "export const cart={items:[] as string[]};export function add(){cart.items.push('x');}",
    "import * as store from './store';export function Reader(){return <output id=\"out\">{store.cart.items.length}</output>;}",
    app("import {add} from './store';", 'add')],
  ['computed member', "export const cart={items:[] as string[]};export function add(){cart.items.push('x');}",
    "import * as store from './store';export function Reader(){return <output id=\"out\">{store['cart'].items.length}</output>;}",
    app("import * as ops from './store';", '()=>ops.add()')],
])('links namespace imports used through static members (%s)',async(label,store,reader,writer)=>{
  expect(await clickAndRead(`namespace-${label.replaceAll(' ','-')}`,{'./store.ts':store,'./Reader.tsx':reader,'./App.tsx':writer},2))
    .toEqual(['0','1','2']);
});

it('keeps type positions of a lowered namespace import',()=>{
  const output=compile({
    './store.ts':"export type Item={id:number};export const items:Item[]=[];",
    './App.tsx':"import * as store from './store';export function App(){const first:store.Item|undefined=store.items[0];return <p>{store.items.length}{first?.id}</p>;}",
  });
  expect(output['./App.tsx']).toMatch(/import \{ items as _ns_store_items \} from ["']\.\/store["']/);
  expect(output['./App.tsx']).not.toContain('import * as store');
});

it('still rejects a namespace import used as a value',()=>{
  expect(()=>compile({
    './store.ts':"export const cart={items:[] as string[]};",
    './App.tsx':"import * as store from './store';export function App(){return <p>{Object.keys(store).length}</p>;}",
  })).toThrow(/is used as a value/);
});

it.each([
  ['object-literal getter', "export const totals={get sum(){return cart.reduce((a,b)=>a+b,0);}};"],
  ['class getter on an instance', "class Totals{get sum(){return cart.reduce((a,b)=>a+b,0);}}export const totals=new Totals();"],
  ['object-literal method', "export const totals={sum(){return cart.reduce((a,b)=>a+b,0);}};"],
])('updates readers of a %s over other module state',async(label,totals)=>{
  const read=label.endsWith('method')?'totals.sum()':'totals.sum';
  expect(await clickAndRead(`getter-${label.replaceAll(' ','-')}`,{
    './store.ts':`export const cart:number[]=[];${totals}export function add(){cart.push(5);}`,
    './Reader.tsx':`import {totals} from './store';export function Reader(){return <output id="out">{${read}}</output>;}`,
    './App.tsx':app("import {add} from './store';",'add'),
  },2)).toEqual(['0','5','10']);
});

it('updates readers of an instance of an imported class whose getter reads its own module',async()=>{
  expect(await clickAndRead('imported-class-getter',{
    './cart.ts':"export const cart:number[]=[];export function add(){cart.push(5);}export class Totals{get sum(){return cart.reduce((a,b)=>a+b,0);}}",
    './totals.ts':"import {Totals} from './cart';export const totals=new Totals();",
    './Reader.tsx':"import {totals} from './totals';export function Reader(){return <output id=\"out\">{totals.sum}</output>;}",
    './App.tsx':app("import {add} from './cart';",'add'),
  },2)).toEqual(['0','5','10']);
});
