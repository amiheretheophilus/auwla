import { expect, it } from 'bun:test';
import { compileServerPage } from '../packages/compiler/src/page-compiler';
import { pageInputPaths } from '../packages/compiler/src/page-projection';
import { projectPageInputs } from '../packages/server/src/page-inputs';

it.each([
  `export function Child(props){let clicks=0;return <button onClick={()=>clicks++}>{props.title}:{props.count}:{clicks}</button>}`,
  `export function Child(props={}){let clicks=0;return <button onClick={()=>clicks++}>{props.title}:{props.count}:{clicks}</button>}`,
  `export function Child(title='Untitled',count=0){let clicks=0;return <button onClick={()=>clicks++}>{title}:{count}:{clicks}</button>}`,
  `export function Child({title,count}={}){let clicks=0;return <button onClick={()=>clicks++}>{title}:{count}:{clicks}</button>}`,
])('uses the shared component prop shape for page inputs: %s', child => {
  const compiled=compileServerPage({
    './page.tsx':`import {Child} from './Child';export function Page(inputs){return <div><Child title={inputs[0].title} count={inputs[0].count}/></div>}`,
    './Child.tsx':child,
  },'./page.tsx','Page',1,{resolveImport:specifier=>specifier==='./Child'?'./Child.tsx':undefined});
  expect(compiled.delivery.browser).toBe('bindings');
  expect(projectPageInputs([{title:'Board',count:3,secret:'PRIVATE'}],compiled.delivery.paths))
    .toEqual([{title:'Board',count:3}]);
});

it.each(['title','count'])('projects only the used defaulted positional prop: %s', name => {
  const compiled=compileServerPage({'./page.tsx':`export function Page(inputs){return <div><Child title={inputs[0].title} count={inputs[0].count}/></div>}
    function Child(title='Untitled',count=0){let clicks=0;return <button onClick={()=>clicks++}>{${name}}:{clicks}</button>}`},'./page.tsx','Page',1);
  expect(compiled.delivery.paths).toEqual([[0,name]]);
});

it('accounts for spread arguments and attribute override order without copying opaque objects', () => {
  const paths=(attributes:string,child=`function Child(props){return <p>{props.title}</p>}`)=>pageInputPaths({
    './page.tsx':`export function Page(inputs){return <Child ${attributes}/>}${child}`,
  },'./page.tsx','Page',2,()=>undefined);
  expect(paths(`{...{...{title:inputs[0].title},unused:inputs[0].secret}} title={inputs[1]}`)).toEqual([[1]]);
  expect(paths(`title={inputs[1]} {...{title:inputs[0].title,unused:inputs[0].secret}}`)).toEqual([[0,'title']]);
  const opaque=paths(`{...inputs[0]}`);
  expect(opaque).toEqual([[0]]);
  expect(()=>projectPageInputs([{title:'Board',secret:'PRIVATE'}],opaque)).toThrow('not whole objects');
  const intrinsic=pageInputPaths({'./page.tsx':`export function Page(inputs){return <div {...{title:inputs[0].title}}/>}`},'./page.tsx','Page',1,()=>undefined);
  expect(intrinsic).toEqual([[0,'title']]);
});

it.each([false,true])('merges wildcard and index selections recursively, independent of path order: %s', reverse => {
  const paths:(string|number)[][]=[[0,'*','title'],[0,0,'id'],[0,'0','meta','label'],[0,'*','meta','visible'],[0,'*','rows','*','name'],[0,0,'rows',0,'id']];
  if(reverse)paths.reverse();
  const projected=projectPageInputs([[
    {id:'a',title:'First',secret:'PRIVATE',meta:{label:'A',visible:true,secret:'PRIVATE'},rows:[{id:1,name:'one',secret:'PRIVATE'}]},
    {id:'b',title:'Second',meta:{label:'B',visible:false},rows:[{id:2,name:'two'}]},
  ]],paths);
  expect(projected).toEqual([[
    {id:'a',title:'First',meta:{label:'A',visible:true},rows:[{id:1,name:'one'}]},
    {title:'Second',meta:{visible:false},rows:[{name:'two'}]},
  ]]);
  expect(JSON.stringify(projected)).not.toContain('PRIVATE');
});

it('keeps primitive-only validation when wildcard and index selections overlap', () => {
  expect(()=>projectPageInputs([[{id:'a',title:'First'}]],[[0,'*','title'],[0,0]]))
    .toThrow('not whole objects');
  expect(()=>projectPageInputs([[{title:'First'}]],[[0,'*','title'],[0,3,'id']]))
    .toThrow('invalid page array projection');
});
