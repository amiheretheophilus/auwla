import {afterEach,expect,it,vi} from 'bun:test';
import {compileModules} from '@memoized-dom/compiler';
import * as runtime from '@memoized-dom/runtime/testing';
import * as data from '@memoized-dom/data';
import * as internalData from '@memoized-dom/data/internal';
import {waitFor} from '../test-support/helpers';

afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();});

it.each([true,false])('preserves pull provenance through fetched component rows (keyed=%s)',async keyed=>{
  const code=compileModules({'./app.tsx':`
    import {opaqueStatus} from 'external-status';
    function Label({note}) {
      $effect(()=>{console.log('nested',note);});
      return <span>{note.text}</span>;
    }
    function Notes({note,busy}) {
      let editing=false;let text=note.text;
      $effect(()=>{console.log('editing',editing);});
      $effect(()=>{console.log('note',note);});
      return <li><Label note={note}/><button class="edit" onClick={()=>editing=!editing}>{editing?'Editing':'View'}</button>
        <input value={text} onInput={event=>text=event.currentTarget.value}/><b>{busy?'Busy':'Idle'}</b></li>;
    }
    export function App(){
      const status=opaqueStatus();const notes=$fetch('/notes');let busy=false;
      return <section data-status={status.value}><button class="refresh" onClick={()=>$track(notes).refresh()}>Refresh</button>
        <button class="busy" onClick={()=>busy=!busy}>Busy</button>
        <ul>{notes.map(note=><Notes ${keyed?'key={note.id}':''} note={note} busy={busy}/>)}</ul></section>;
    }
  `},{runtimePath:'@memoized-dom/runtime/testing'})['./app.tsx']!;
  expect(code).toContain('volatile: true');
  const frames:Array<()=>void>=[];
  const app=runtime.createApplicationRuntime('effect-pull',{document,schedule:run=>frames.push(run)});
  let requests=0;
  const source=data.createDataRuntime({fetch:async()=>{requests++;return Response.json([{id:'n1',text:requests===1?'Original':'Updated'}]);}});
  const previous=data.setActiveDataRuntime(source);
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const opaque={value:'fixed'};
  const calls=(name:string)=>log.mock.calls.filter(args=>args[0]===name).length;
  try {
    runtime.runWithApplicationRuntime(app,()=>{
      runtime.setScheduler(run=>run());
      const App=new Function('_MD','_MDD','$fetch','$track','opaqueStatus',
        code.replace(/^import .*;$/gm,'').replace(/export function /g,'function ')+'\nreturn App;')(
          runtime,internalData,data.$fetch,data.$track,()=>opaque);
      document.body.appendChild(App('App',null));
    });
    await waitFor(()=>expect(document.querySelector('span')?.textContent).toBe('Original'));
    expect([calls('editing'),calls('note'),calls('nested')]).toEqual([1,1,1]);
    const pump=()=>{expect(frames.length).toBeGreaterThan(0);frames.shift()!();};
    for(let index=0;index<5;index++)pump();
    expect(requests).toBe(1);
    expect([calls('editing'),calls('note'),calls('nested')]).toEqual([1,1,1]);
    opaque.value='externally changed';pump();
    expect(document.querySelector('section')!.getAttribute('data-status')).toBe('externally changed');
    expect([calls('editing'),calls('note'),calls('nested')]).toEqual([1,1,1]);
    const click=(selector:string)=>runtime.runWithApplicationRuntime(app,()=>document.querySelector<HTMLButtonElement>(selector)!.click());
    click('.edit');
    expect(calls('editing')).toBe(2);
    expect(calls('note')).toBe(1);
    document.querySelector<HTMLInputElement>('input')!.value='Unsubmitted';
    runtime.runWithApplicationRuntime(app,()=>document.querySelector('input')!.dispatchEvent(new Event('input')));
    pump();
    expect(calls('editing')).toBe(2);
    click('.refresh');
    await waitFor(()=>expect(document.querySelector('span')?.textContent).toBe('Updated'));
    expect(calls('note')).toBeGreaterThan(1);
    expect(calls('nested')).toBeGreaterThan(1);
    // Without an authored key, replacing the fetched object creates a new
    // identity-keyed row and legitimately runs its initial effects again.
    expect(calls('editing')).toBe(keyed?2:3);
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe(keyed?'Unsubmitted':'Updated');
    const counts=[calls('editing'),calls('note'),calls('nested')];
    for(let index=0;index<5;index++)pump();
    expect([calls('editing'),calls('note'),calls('nested')]).toEqual(counts);
  } finally {app.dispose();source.clear();data.setActiveDataRuntime(previous);}
});

it('keeps real pending causes when a pull forwards props, and isolates update scopes',()=>{
  const app=runtime.createApplicationRuntime('mixed-pull',{document,schedule:null});
  const other=runtime.createApplicationRuntime('other',{document,schedule:null});
  const seen:runtime.DirtyReasons[]=[];
  const value={text:'same'};
  try {
    runtime.runWithApplicationRuntime(app,()=>{
      runtime.setScheduler(()=>{});
      runtime.registerEntity({id:'Parent',parent:null,render(){
        runtime.runWithApplicationRuntime(other,()=>{
          runtime.registerEntity({id:'Other',parent:null,render:reasons=>seen.push(reasons??null)});
          runtime.registerProps('Other',[{value}],{value:7});
          runtime.setProps('Other',[{value}]);runtime.renderEntity('Other');
        });
        runtime.setProps('Child',[{value}]);runtime.renderEntity('Child');
      }});
      runtime.registerEntity({id:'Child',parent:'Parent',render:reasons=>seen.push(reasons??null)});
      runtime.registerProps('Child',[{value}],{value:3});
      runtime.markDirty('Child',9);runtime.markDirty('Parent',-1);runtime.commit();
    });
    expect(seen[0]).toEqual(7);
    expect(seen[1]).toEqual(new Set([9,-1]));
  } finally {app.dispose();other.dispose();}
});
