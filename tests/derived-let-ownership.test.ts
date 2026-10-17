import { afterEach, expect, it } from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileModules} from '@memoized-dom/compiler';
import {registeredIds,unregisterSubtree,setScheduler,resetScheduler} from '@memoized-dom/runtime/testing';

/**
 * Derivation vs ownership (docs/02-state.md, "When a derived value becomes
 * local state"). A binding initialized from reactive state follows its source
 * until the binding itself is written.
 */
afterEach(()=>{
  for(const id of registeredIds())unregisterSubtree(id);
  resetScheduler();document.body.replaceChildren();
});

const MAIN="import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);";

async function run(name:string,modules:Record<string,string>,clicks:string[]){
  const output=compileModules({'./main.ts':MAIN,...modules},{runtimePath:'@memoized-dom/runtime/testing'});
  const directory=join(import.meta.dirname,'fixtures/out/derived-let-ownership',name);
  mkdirSync(directory,{recursive:true});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  const seen=[document.querySelector('#out')!.textContent];
  for(const id of clicks){document.querySelector<HTMLButtonElement>(`#${id}`)!.click();seen.push(document.querySelector('#out')!.textContent);}
  return seen;
}

/** `src` changes the source; `own` writes the binding; output is `source/binding`. */
const app=(declaration:string,read:string,ownWrite:string)=>({'./App.tsx':
  `function label(n:{name:string}){return n.name;}
   export function App(){const state={user:{name:'a'}};${declaration}
   return <main><output id="out">{state.user.name}/{${read}}</output>
     <button id="src" onClick={()=>{state.user={name:'b'};}}/>
     <button id="own" onClick={()=>{${ownWrite}}}/></main>;}`});

it.each([
  // [label, declaration, read, own write, source change then own write]
  ['never written: follows the source', 'let user=state.user;', 'user.name', '', ['b/b', 'b/b']],
  ['reassigned: local state from then on', 'let name=state.user.name;', 'name', "name='mine';", ['b/a', 'b/mine']],
  ['function result reassigned: local state', 'let name=label(state.user);', 'name', "name='mine';", ['b/a', 'b/mine']],
  // Any write makes a `let` local state, a mutation included; it changes the object captured at mount.
  ['let object mutated: local state, mutation hits the captured object', 'let user=state.user;', 'user.name', "user.name='mine';", ['b/a', 'b/mine']],
  ['const alias mutated: writes go to the current source', 'const user=state.user;', 'user.name', "user.name='mine';", ['b/b', 'mine/mine']],
])('%s', async (label, declaration, read, ownWrite, after) => {
  const seen = await run(label.replace(/[^a-z]+/gi, '-'), app(declaration, read, ownWrite), ['src', 'own']);
  expect(seen).toEqual(['a/a', ...after]);
});
