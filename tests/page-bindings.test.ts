import { afterEach, expect, it } from 'bun:test';
import * as runtime from '@memoized-dom/runtime';
import * as serverRuntime from '@memoized-dom/runtime/server';
import { compileServerPage } from '../packages/compiler/src/page-compiler';
import { createServerPage, renderServerPage } from '../packages/server/src/page';
import { encodePageInputs, projectPageInputs } from '../packages/server/src/page-inputs';
import { pageBindingInputs } from '../packages/runtime/src/page-content';

afterEach(() => document.body.replaceChildren());
it('preserves optional undefined props without colliding with user object values',()=>{
  const encoded=encodePageInputs([undefined,{$mmd:'undefined',optional:undefined,rows:[{name:undefined}]}]);
  const decoded=pageBindingInputs(JSON.parse(JSON.stringify({key:'test',...encoded})));
  expect(decoded).toEqual([undefined,{$mmd:'undefined',optional:undefined,rows:[{name:undefined}]}]);
  expect(()=>pageBindingInputs({key:'bad',inputs:[{}],missing:[[0,'__proto__']]})).toThrow('input path');
});
it('rejects accessor, service, prototype and whole-object inputs before serialization',()=>{
  let getters=0;const value={get name(){getters++;return 'secret';}};
  expect(()=>projectPageInputs([value],[[0,'name']])).toThrow('getters');expect(getters).toBe(0);
  class Service {name='secret';}
  expect(()=>projectPageInputs([new Service()],[[0,'name']])).toThrow('class instances');
  expect(()=>projectPageInputs([{}],[[0,'__proto__']])).toThrow('unsafe');
  expect(()=>projectPageInputs([()=>{}],[[0]])).toThrow('server closures');
});

it('retains opaque noninteractive rendering on the server and refuses unproved interactive setup reads',()=>{
  const passive=compileServerPage({'./page.tsx':`export function Page(inputs){const name=inputs[0].name.toUpperCase();return <div><h1>{name}</h1></div>}`},'./page.tsx','Page',1);
  expect(passive.delivery.browser).toBe('none');expect(passive.browser).toEqual({});expect(passive.delivery.paths).toEqual([]);
  expect(()=>compileServerPage({'./page.tsx':`export function Page(){const user=$fetch('/user');let count=0;return <div><h1>{user.name}</h1><button onClick={()=>count++}>{count}</button></div>}`},'./page.tsx','Page',0)).toThrow('unsupported browser creation');
});
function evaluate(code: string, api: typeof runtime): (id:string,parent:null,props:unknown[]) => Node {
  const imports = [...code.matchAll(/^import \* as (\w+) from [^;]+;/gm)].map(match => `const ${match[1]}=api;`).join('\n');
  const output = code.replace(/^import \* as (\w+) from [^;]+;/gm, '')
    .replace(/export function /g,'function ');
  return new Function('api', imports + '\n' + output + '\nreturn Page;')(api);
}

it('projects only fields used by composed page bindings, including row aliases', () => {
  const source = { './page.tsx': `import {Rows} from './Rows';export function Page(inputs){const users=inputs[0];return <div><Rows users={users}/></div>}`,
    './Rows.tsx': `export function Rows({users}){let open=false;return <section><button onClick={()=>open=!open}>Toggle</button>{users.map(user=><p key={user.id}>{user.name}</p>)}</section>}` };
  const compiled = compileServerPage(source,'./page.tsx','Page',1,{resolveImport:specifier=>specifier === './Rows' ? './Rows.tsx' : undefined});
  expect(compiled.delivery.browser).toBe('bindings');
  const inputs = projectPageInputs([[{id:'1',name:'Ada',password:'SECRET'}]], compiled.delivery.paths);
  expect(JSON.parse(JSON.stringify(inputs))).toEqual([[{id:'1',name:'Ada'}]]);
  expect(JSON.stringify(inputs)).not.toContain('SECRET');
  expect(() => projectPageInputs([{password:'SECRET'}],[[0]])).toThrow('not whole objects');
});

it.each([
  `function show(){globalThis.showName(user.name)}const user=inputs[0];`,
  `const show=()=>globalThis.showName(user.name);const user=inputs[0];`,
  `const user=inputs[0];function reveal(value){globalThis.showName(value.name)}const show=()=>reveal(user);`,
])('projects values read only by lexical event helpers: %s', (setup) => {
  const compiled=compileServerPage({'./page.tsx':`export function Page(inputs){${setup}return <div><button onClick={show}>Show name</button></div>}`},'./page.tsx','Page',1);
  expect(projectPageInputs([{name:'Ada',password:'SECRET'}],compiled.delivery.paths)).toEqual([{name:'Ada'}]);
});

it('binds server HTML, isolates repeated page events and preserves local state on new inputs', async () => {
  const source = `export function Page(inputs){const user=inputs[0];let count=0;return <div><h1>{user.name}</h1><button onClick={async()=>{await Promise.resolve();count++}}>Count {count}</button></div>}`;
  const compiled = compileServerPage({'./page.tsx':source},'./page.tsx','Page',1);
  const server = evaluate(compiled.server['./page.tsx']!,serverRuntime);
  const browser = evaluate(compiled.browser['./page.tsx']!,runtime);
  runtime.registerCompiledPage(compiled.delivery.key,browser,'Page');
  const make = (name:string) => createServerPage('test/page',(id,parent,inputs)=>server(id,parent,[inputs]),
    [{name,password:'SECRET'}],compiled.delivery,true);
  let first = runtime.acceptPageContent(await renderServerPage(make('Ada')));
  const second = runtime.acceptPageContent(await renderServerPage(make('Grace')));
  expect(first.html).toContain('Ada'); expect(JSON.stringify(first)).not.toContain('SECRET');
  const a=document.createElement('main'), b=document.createElement('aside'); document.body.append(a,b);
  const regionA=runtime.createContentRegion(a,'first',()=>first);
  const regionB=runtime.createContentRegion(b,'second',()=>second);
  const button=a.querySelector('button')!; button.click(); await Bun.sleep(5);
  expect(button.textContent).toBe('Count 1'); expect(b.querySelector('button')?.textContent).toBe('Count 0');
  first=runtime.acceptPageContent(await renderServerPage(make('Updated')));regionA.update();await Bun.sleep(5);
  expect(a.querySelector('button')).toBe(button); expect(button.textContent).toBe('Count 1');
  expect(a.querySelector('h1')?.textContent).toBe('Updated');
  regionA.dispose();regionB.dispose();expect(a.childNodes.length+b.childNodes.length).toBe(0);
});

it('avoids collisions with authored page-runtime names when selecting binding helpers', async () => {
  const source = `export function Page(){const _pageRuntime=2,_pagePrimitives=3;let count=0;
    return <div><button onClick={async()=>{await Promise.resolve();count+=_pageRuntime+_pagePrimitives}}>Count {count}</button></div>}`;
  const compiled = compileServerPage({'./page.tsx':source},'./page.tsx','Page',0);
  const server = evaluate(compiled.server['./page.tsx']!,serverRuntime);
  const browser = evaluate(compiled.browser['./page.tsx']!,runtime);
  runtime.registerCompiledPage(compiled.delivery.key,browser,'Page');
  const content = runtime.acceptPageContent(await renderServerPage(createServerPage('collision/page',
    (id,parent,inputs)=>server(id,parent,[inputs]),[],compiled.delivery,true)));
  const host=document.createElement('main');document.body.append(host);
  const region=runtime.createContentRegion(host,'collision',()=>content);
  try {
    host.querySelector('button')!.click();await Bun.sleep(5);
    expect(host.querySelector('button')?.textContent).toBe('Count 5');
  } finally {region.dispose();}
});

it('selects binding helpers for the configured runtime path', () => {
  const compiled=compileServerPage({'./page.tsx':`export function Page(){let count=0;
    return <div><button onClick={()=>count++}>{count}</button></div>}`},'./page.tsx','Page',0,{runtimePath:'@custom/runtime'});
  const browser=compiled.browser['./page.tsx']!;
  expect(browser).toContain('@custom/runtime');
  expect(browser).toContain('bindRuntimeNamespace');
  expect(browser).not.toMatch(/bindRuntimeNamespace\((_pageRuntime\w*)\)/);
});

it.each([
  `function Child(props){let clicks=0;return <button onClick={()=>clicks+=props.count}>{props.title}:{clicks}</button>}`,
  `function Child(title='Untitled',count=0){let clicks=0;return <button onClick={()=>clicks+=count}>{title}:{clicks}</button>}`,
])('binds composed page inputs and preserves local state when props update: %s', async child => {
  const source=`export function Page(inputs){return <div><Child title={inputs[0].title} count={inputs[0].count}/></div>}${child}`;
  const compiled=compileServerPage({'./page.tsx':source},'./page.tsx','Page',1);
  const server=evaluate(compiled.server['./page.tsx']!,serverRuntime),browser=evaluate(compiled.browser['./page.tsx']!,runtime);
  runtime.registerCompiledPage(compiled.delivery.key,browser,'Page');
  const make=async(title:string,count:number)=>runtime.acceptPageContent(await renderServerPage(createServerPage('props/page',
    (id,parent,inputs)=>server(id,parent,[inputs]),[{title,count,password:'SECRET'}],compiled.delivery,true)));
  let content=await make('First',2);
  expect(JSON.stringify(content)).not.toContain('SECRET');
  const host=document.createElement('main');document.body.append(host);
  const region=runtime.createContentRegion(host,'props',()=>content);
  try{
    const button=host.querySelector('button')!;button.click();await Bun.sleep(5);
    expect(button.textContent).toBe('First:2');
    content=await make('Second',3);region.update();await Bun.sleep(5);
    expect(host.querySelector('button')).toBe(button);expect(button.textContent).toBe('Second:2');
    button.click();await Bun.sleep(5);expect(button.textContent).toBe('Second:5');
  }finally{region.dispose();}
});
