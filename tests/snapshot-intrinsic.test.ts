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

async function mountApp(name:string,app:string,modules:Record<string,string>={}){
  const directory=join(import.meta.dirname,'fixtures/out/snapshot-intrinsic',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(compile({'./App.tsx':app,...modules})))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    out:()=>document.querySelector('#out')!.textContent,
  };
}

const EDITOR=(saved:string)=>`export function App(){const state={user:{name:'ann'}};${saved}
  return <main><output id="out">{state.user.name}</output>
    <button id="edit" onClick={()=>{state.user={name:'bob'};}}/>
    <button id="undo" onClick={()=>{state.user=saved;}}/></main>;}`;

it('keeps the captured object for undo, unlike a live alias',async()=>{
  const snapshot=await mountApp('undo',EDITOR('const saved=$snapshot(state.user);'));
  snapshot.click('edit');expect(snapshot.out()).toBe('bob');
  snapshot.click('undo');expect(snapshot.out()).toBe('ann');
  unregisterSubtree('App');document.body.replaceChildren();

  // The documented live-alias rule is unchanged for a plain const.
  const live=await mountApp('live-alias',EDITOR('const saved=state.user;'));
  live.click('edit');live.click('undo');
  expect(live.out()).toBe('bob');
});

it('captures a primitive once while plain derivations follow',async()=>{
  const app=await mountApp('primitive',`export function App(){let count=1;const initial=$snapshot(count);const doubled=count*2;
    return <main><output id="out">{initial}/{count}/{doubled}</output><button id="inc" onClick={()=>count++}/></main>;}`);
  expect(app.out()).toBe('1/1/2');
  app.click('inc');app.click('inc');
  expect(app.out()).toBe('1/3/6');
});

it('snapshots module state and destructuring patterns',async()=>{
  const app=await mountApp('module-and-pattern',
    `import {settings,setTheme} from './settings';const first=$snapshot(settings.theme);
     export function App(){const {theme:initial}=$snapshot(settings);
       return <main><output id="out">{first}/{initial}/{settings.theme}</output><button id="set" onClick={()=>setTheme('dark')}/></main>;}`,
    {'./settings.ts':"export let settings={theme:'light'};export function setTheme(theme:string){settings={theme};}"});
  expect(app.out()).toBe('light/light/light');
  app.click('set');
  expect(app.out()).toBe('light/light/dark');
});

it('lowers only the snapshot declarators of a mixed declaration',()=>{
  const output=compile({'./App.tsx':`export function App(){let n=1;const a=n+1,b=$snapshot(n),c=b+1;
    return <button onClick={()=>n++}>{a}{b}{c}</button>;}`});
  expect(output['./App.tsx']).not.toContain('$snapshot');
  expect(output['./App.tsx']).toMatch(/let b;\s*b = n;/);
});

it.each([
  ['inside JSX','export function App(){let n=0;return <p>{$snapshot(n)}</p>;}',/must initialize a declaration/],
  ['as a value','export function App(){const take=$snapshot;return <p/>;}',/must initialize a declaration/],
  ['with no value','export function App(){const x=$snapshot();return <p/>;}',/takes exactly one value/],
  ['on an export','let n=0;export const first=$snapshot(n);export function App(){return <p/>;}',/cannot initialize an export/],
])('rejects $snapshot %s',(_label,app,message)=>{
  expect(()=>compile({'./App.tsx':app})).toThrow(message);
});

it('leaves a locally declared $snapshot alone',()=>{
  const output=compile({'./App.tsx':`function $snapshot<T>(value:T){return value;}
    export function App(){let n=0;const x=$snapshot(n);return <button onClick={()=>n++}>{x}</button>;}`});
  expect(output['./App.tsx']).toContain('$snapshot(n)');
});
