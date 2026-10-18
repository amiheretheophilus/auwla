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

async function mountApp(name:string,app:string,modules:Record<string,string>={}){
  const directory=join(import.meta.dirname,'fixtures/out/mixed-placement',name);
  mkdirSync(directory,{recursive:true});
  const output=compileModules({'./main.ts':MAIN,'./App.tsx':app,...modules},{runtimePath:'@memoized-dom/runtime/testing'});
  for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());document.body.append(App('App',null));
  return {
    click:(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    html:()=>document.querySelector('main')!.innerHTML.replace(/<!--[^>]*-->/g,''),
  };
}

// Conduit: <AuthorLine> in every feed row and once on the article page.
const AUTHOR = `export function Author({ person }: { person: { name: string } }) { return <b>{person.name}</b>; }`;
const APP = (importLine: string, local: string) => `${importLine}${local}
  export function App() { let lead = { name: 'ada' }; let rows = [{ id: 1, name: 'grace' }, { id: 2, name: 'linus' }];
    return <main><button id="rename" onClick={() => { lead = { name: 'ADA' }; rows[0]!.name = 'GRACE'; rows = [...rows]; }} />
      <Author person={lead} /><ul>{rows.map(row => <li key={row.id}><Author person={row} /></li>)}</ul></main>; }`;

it.each([
  ['in one module', APP('', AUTHOR), {}],
  ['across modules', APP("import { Author } from './Author';", ''), { './Author.tsx': AUTHOR }],
] as const)('a component used both as a static child and inside list rows (%s)', async (name, app, modules) => {
  const mounted=await mountApp(name.replace(/ /g,'-'),app,modules);
  expect(mounted.html()).toContain('<b>ada</b><ul><li><b>grace</b></li><li><b>linus</b></li></ul>');
  mounted.click('rename');
  expect(mounted.html()).toContain('<b>ADA</b><ul><li><b>GRACE</b></li><li><b>linus</b></li></ul>');
});

it('a component used both as a static child and as the row itself', async () => {
  const mounted=await mountApp('direct-row',`function Tag({ label }: { label: string }) { return <i>{label}</i>; }
    export function App() { let tags = ['a', 'b']; let lead = 'x';
      return <main><button id="rename" onClick={() => { lead = 'y'; tags = [...tags, 'c']; }} />
        <Tag label={lead} />{tags.map(tag => <Tag key={tag} label={tag} />)}</main>; }`);
  expect(mounted.html()).toContain('<i>x</i><i>a</i><i>b</i>');
  mounted.click('rename');
  expect(mounted.html()).toContain('<i>y</i><i>a</i><i>b</i><i>c</i>');
});
