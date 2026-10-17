import {expect,it,vi} from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {experimentalCompilePackage,compileModulesDetailed,emitInitialHtml,validateExperimentalPackageArtifact} from '@memoized-dom/compiler';
import {mountInitial} from '@memoized-dom/runtime/testing';
import {waitFor} from '../test-support/helpers';

it.each([true,false])('binds package fallbacks independently of projected slot widths (open=%s)',async open=>{
  const runtimePath='@memoized-dom/runtime/testing';
  const packaged=experimentalCompilePackage({
    './index.tsx':`export function Panel({title,onPress}:{title:string;onPress:()=>void}){return <section>
      <header>{title}<span class="before">Before</span><slot name="heading"><h2 class="fallback-title" onClick={onPress}>{title}</h2></slot><strong class="after">{title}</strong></header>
      <main><span>Body</span><slot><p class="fallback-body">{title}</p><input class="fallback-draft"/></slot><strong class="body-after">{title}</strong></main>
      <footer><b>End</b><slot name="caption">{title}</slot><strong>{title}</strong></footer>
    </section>;}`,
  },{runtimePath,packageEntries:{'fallback-ui':'./index.tsx'}});
  expect(packaged.artifact.entries['fallback-ui']!.components!.Panel.initial?.adoption).toBe('host-slots-v2');
  const application=compileModulesDetailed({
    './main.ts':`import {mount} from '${runtimePath}';import {App} from './app';mount('root',App);`,
    './app.tsx':`import {Panel} from 'fallback-ui';export function App(){let title='';let count=0;let open=${open};let rows=[{id:1},{id:2}];
      return <div><button class="change" onClick={()=>{title='Updated';count++;}}>Change</button>
        <button class="toggle" onClick={()=>open=!open}>Toggle</button>
        <button class="append" onClick={()=>rows=[...rows,{id:3}]}>Append</button>
        <Panel title={title} onPress={()=>count++}/>
        <Panel title={title} onPress={()=>count++}><button slot="heading" class="projected" onClick={()=>count++}>{count}</button><b>{count}</b><input class="projected-draft"/>{rows.map(row=><small key={row.id}>{row.id}:{count}</small>)}</Panel>
        {open&&<Panel title={title} onPress={()=>count++}><i>{count}</i></Panel>}
      </div>;}`,
  },{runtimePath,initialContent:true,experimentalPackageArtifacts:[JSON.parse(JSON.stringify(packaged.artifact))]});
  expect(application.initialRender.kind).toBe('bindings');
  expect(application.initialContent).toBe(true);
  const directory=join(import.meta.dirname,'fixtures/out/package-slot-fallbacks',String(open));
  const dependency=join(directory,'node_modules/fallback-ui');
  mkdirSync(dependency,{recursive:true});
  writeFileSync(join(dependency,'package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
  writeFileSync(join(dependency,'index.js'),packaged.output['./index.tsx']!);
  writeFileSync(join(directory,'app.js'),application.output['./app.tsx']!);
  document.body.innerHTML=`<div id="root">${emitInitialHtml(application.initialRender)}</div>`;
  const originals=[...document.querySelectorAll('*')];
  const create=vi.spyOn(document,'createElement');
  let mounted:ReturnType<typeof mountInitial>|undefined;
  const click=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!.click();
  try{
    const {App}=await import(`${pathToFileURL(join(directory,'app.js')).href}?fallback=${Date.now()}`);
    mounted=mountInitial('root',App);
    expect(create).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('*')].every((node,index)=>node===originals[index])).toBe(true);
    create.mockRestore();
    if(!open){click('.toggle');await waitFor(()=>expect(document.querySelectorAll('section').length).toBe(3));}
    const draft=document.querySelector<HTMLInputElement>('.fallback-draft')!;
    draft.value='Fallback draft';
    const projected=document.querySelector<HTMLInputElement>('.projected-draft')!;
    projected.value='Caller draft';
    click('.change');
    await waitFor(()=>{
      expect([...document.querySelectorAll('.fallback-title')].map(node=>node.textContent)).toEqual(['Updated','Updated']);
      expect(document.querySelector('.fallback-body')!.textContent).toBe('Updated');
      expect(document.querySelector('.projected')!.textContent).toBe('1');
      expect(document.querySelector('main b')!.textContent).toBe('1');
      expect([...document.querySelectorAll('.after,.body-after')].every(node=>node.textContent==='Updated')).toBe(true);
      expect([...document.querySelectorAll('footer')].every(node=>node.textContent==='EndUpdatedUpdated')).toBe(true);
    });
    expect(document.querySelector('.fallback-draft')).toBe(draft);
    expect(draft.value).toBe('Fallback draft');expect(projected.value).toBe('Caller draft');
    click('.projected');await waitFor(()=>expect(document.querySelector('i')!.textContent).toBe('2'));
    click('.fallback-title');await waitFor(()=>expect(document.querySelector('i')!.textContent).toBe('3'));
    click('.append');await waitFor(()=>{
      expect([...document.querySelectorAll('small')].map(node=>node.textContent)).toEqual(['1:3','2:3','3:3']);
      expect([...document.querySelectorAll('.body-after')].every(node=>node.textContent==='Updated')).toBe(true);
    });
    click('.toggle');await waitFor(()=>expect(document.querySelectorAll('section').length).toBe(2));
    click('.toggle');await waitFor(()=>{
      expect(document.querySelectorAll('section').length).toBe(3);
      expect(document.querySelectorAll('.fallback-title')[1]!.textContent).toBe('Updated');
      expect(document.querySelector('i')!.textContent).toBe('3');
    });
  }finally{create.mockRestore();mounted?.unmount();document.body.replaceChildren();}
});

it('keeps static fallbacks inert and empty fallback syntax on the portable path',()=>{
  const packaged=experimentalCompilePackage({
    './index.tsx':`export function Panel(){return <section><b>Before</b><slot><i>Empty</i></slot><b>After</b></section>;}
      export function Empty(){return <aside><slot>{null}{false}{undefined}{/* nothing */}</slot></aside>;}`,
  },{packageEntries:{'static-fallback':'./index.tsx'}});
  const result=compileModulesDetailed({
    './main.ts':`import {mount} from '@memoized-dom/runtime';import {App} from './app';mount('root',App);`,
    './app.tsx':`import {Panel,Empty} from 'static-fallback';export function App(){return <main><Panel/><Panel>{null}</Panel><Empty/></main>;}`,
  },{initialContent:true,experimentalPackageArtifacts:[packaged.artifact]});
  expect(result.initialRender.kind).toBe('html');
  expect(emitInitialHtml(result.initialRender)).toBe('<main><section><b>Before</b><i>Empty</i><b>After</b></section><section><b>Before</b><b>After</b></section><aside></aside></main>');
});

it('keeps ambiguous text, multiple same-host slots and nested fallbacks off the adoption path',()=>{
  const packaged=experimentalCompilePackage({
    './index.tsx':`export function Text(){return <section>Before<slot/>After</section>;}
      export function Multiple(){return <section><slot name="heading"/><b>Between</b><slot/></section>;}
      export function Nested(){return <section><slot><aside><slot name="heading"/></aside></slot></section>;}`,
  },{packageEntries:{'bounded-fallback':'./index.tsx'}});
  for(const name of ['Text','Multiple','Nested']) {
    const component=packaged.artifact.entries['bounded-fallback']!.components![name]!;
    expect(component.initial?.adoption).toBeUndefined();
    const invalid=structuredClone(packaged.artifact);
    invalid.entries['bounded-fallback']!.components![name]!.initial!.adoption='host-slots-v2';
    expect(()=>validateExperimentalPackageArtifact(invalid)).toThrow(name==='Nested'
      ? 'nested fallback slots need a separate placement contract'
      : 'requires one slot per host with element-separated siblings');
  }
});
