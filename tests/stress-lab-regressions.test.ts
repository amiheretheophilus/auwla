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
  const directory=join(import.meta.dirname,'fixtures/out/stress-lab',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(compile(modules)))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    out:()=>document.querySelector('#out')!.textContent,
  };
}

it.each([
  ['wrapped arrow property','()=>handlers.inc()','inc:()=>{count++;}'],
  ['direct arrow property','handlers.inc','inc:()=>{count++;}'],
  ['wrapped method shorthand','()=>handlers.inc()','inc(){count++;}'],
  ['direct method shorthand','handlers.inc','inc(){count++;}'],
])('commits instance writes made through a local command table (%s)',async(label,handler,method)=>{
  const app=await mountApp(`command-table-${label.replaceAll(' ','-')}`,{
    './App.tsx':`export function App(){let count=0;const handlers={${method}};
      return <main><output id="out">{count}</output><button id="a" onClick={${handler}}>+</button></main>;}`,
  });
  expect(app.out()).toBe('0');
  app.click('a');expect(app.out()).toBe('1');
  app.click('a');expect(app.out()).toBe('2');
});

it('links classes imported from another module',async()=>{
  const app=await mountApp('imported-class',{
    './toggle.ts':"export class Toggle{#on=false;flip(){this.#on=!this.#on;}get label(){return this.#on?'on':'off';}}",
    './App.tsx':`import {Toggle} from './toggle';
      export function App(){const t=new Toggle();
      return <main><output id="out">{t.label}</output><button id="a" onClick={()=>t.flip()}>f</button></main>;}`,
  });
  expect(app.out()).toBe('off');
  app.click('a');expect(app.out()).toBe('on');
  app.click('a');expect(app.out()).toBe('off');
});

it('updates other readers when an imported class method writes module state',async()=>{
  const app=await mountApp('imported-reactive-class',{
    './log.ts':"export const entries:string[]=[];export class Logger{log(s:string){entries.push(s);}}",
    './Count.tsx':"import {entries} from './log';export function Count(){return <output id=\"out\">{entries.length}</output>;}",
    './App.tsx':`import {Logger} from './log';import {Count} from './Count';
      export function App(){const logger=new Logger();
      return <main><Count/><button id="a" onClick={()=>logger.log('x')}>log</button></main>;}`,
  });
  expect(app.out()).toBe('0');
  app.click('a');expect(app.out()).toBe('1');
  app.click('a');expect(app.out()).toBe('2');
});

it.each([
  ['for-of with push and key','const rows=[];for(const x of xs)rows.push(<i key={x}>{x}</i>);'],
  ['for-of with push','const rows=[];for(const x of xs)rows.push(<i>{x}</i>);'],
  ['push outside a loop','const rows=[];rows.push(<i>{xs[0]}</i>);'],
])('names imperatively built JSX instead of reporting its symptoms (%s)',(_label,build)=>{
  expect(()=>compile({
    './App.tsx':`export function App(){const xs=[1,2];${build}
      return <main>{rows}<button onClick={()=>xs.push(3)}>push</button></main>;}`,
  })).toThrow(/JSX built in a loop or with push\(\) runs once and never updates/);
});
