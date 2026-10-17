/**
 * Adversarial reactivity cases: ordinary JavaScript patterns an author might
 * write without knowing how the compiler analyses reads and writes.
 *
 * Each case renders `<output id="out">` and buttons with ids. `steps` clicks a
 * button and states what `#out` should read afterwards, judged by plain JS
 * semantics (what the author would expect), not by framework rules.
 */
export interface StressCase {
  name: string;
  /** App.tsx source; must export `App`. */
  app: string;
  /** Extra modules, keyed like './store.ts'. */
  modules?: Record<string, string>;
  initial: string;
  steps: Array<[button: string, expected: string]>;
}

export const cases: StressCase[] = [
  {
    name: 'closure factory with getter',
    modules: {
      './counter.ts': `export function makeCounter(){let n=0;return {inc(){n++;},get value(){return n;}};}
        export const counter=makeCounter();`,
    },
    app: `import {counter} from './counter';
      export function App(){return <main><output id="out">{counter.value}</output>
        <button id="a" onClick={()=>counter.inc()}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'class getter over pushed array',
    modules: {
      './cart.ts': `export class Cart{items:number[]=[];get total(){return this.items.reduce((a,b)=>a+b,0);}
        add(x:number){this.items.push(x);}}
        export const cart=new Cart();`,
    },
    app: `import {cart} from './cart';
      export function App(){return <main><output id="out">{cart.total}</output>
        <button id="a" onClick={()=>cart.add(5)}>add</button></main>;}`,
    initial: '0',
    steps: [['a', '5'], ['a', '10']],
  },
  {
    name: 'filter count after nested field toggle',
    app: `export function App(){const todos=[{id:1,done:false},{id:2,done:false}];
      return <main><output id="out">{todos.filter(t=>t.done).length}</output>
        <button id="a" onClick={()=>{todos[0].done=!todos[0].done;}}>t</button>
        <button id="b" onClick={()=>{todos[1].done=true;}}>t2</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['b', '2'], ['a', '1']],
  },
  {
    name: 'alias chain write',
    app: `export function App(){const state={x:0};const a=state;const b=a;
      return <main><output id="out">{state.x}</output>
        <button id="a" onClick={()=>{b.x++;}}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'mutation through helper parameter',
    modules: { './bump.ts': `export function bump(o:{count:number}){o.count++;}` },
    app: `import {bump} from './bump';
      export function App(){const state={count:0};
      return <main><output id="out">{state.count}</output>
        <button id="a" onClick={()=>bump(state)}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'generic setter utility (dynamic key)',
    modules: { './set.ts': `export const setKey=(o:any,k:string,v:unknown)=>{o[k]=v;};` },
    app: `import {setKey} from './set';
      export function App(){const state={label:'a'};
      return <main><output id="out">{state.label}</output>
        <button id="a" onClick={()=>setKey(state,'label','b')}>set</button></main>;}`,
    initial: 'a',
    steps: [['a', 'b']],
  },
  {
    name: 'computed dynamic key increment',
    app: `export function App(){const scores:Record<string,number>={red:0,blue:0};let key='red';
      return <main><output id="out">{scores.red}-{scores.blue}</output>
        <button id="a" onClick={()=>{scores[key]++;}}>inc</button>
        <button id="b" onClick={()=>{key='blue';}}>swap</button></main>;}`,
    initial: '0-0',
    steps: [['a', '1-0'], ['b', '1-0'], ['a', '1-1']],
  },
  {
    name: 'Map set/get/size',
    app: `export function App(){const m=new Map<string,number>();
      return <main><output id="out">{m.size}:{m.get('k')??'none'}</output>
        <button id="a" onClick={()=>m.set('k',(m.get('k')??0)+1)}>set</button>
        <button id="b" onClick={()=>m.delete('k')}>del</button></main>;}`,
    initial: '0:none',
    steps: [['a', '1:1'], ['a', '1:2'], ['b', '0:none']],
  },
  {
    name: 'Set has toggle',
    app: `export function App(){const s=new Set<number>();
      return <main><output id="out">{s.has(1)?'yes':'no'}</output>
        <button id="a" onClick={()=>{if(s.has(1))s.delete(1);else s.add(1);}}>t</button></main>;}`,
    initial: 'no',
    steps: [['a', 'yes'], ['a', 'no']],
  },
  {
    // By design a const alias is derived: `old` follows state.user (docs/02-state.md).
    name: 'replace nested object then write through a live alias',
    app: `export function App(){const state={user:{name:'ann'}};const old=state.user;
      return <main><output id="out">{state.user.name}</output>
        <button id="a" onClick={()=>{state.user={name:'bob'};}}>r</button>
        <button id="b" onClick={()=>{old.name='stale';}}>old</button>
        <button id="c" onClick={()=>{state.user.name='cy';}}>deep</button></main>;}`,
    initial: 'ann',
    steps: [['a', 'bob'], ['b', 'stale'], ['c', 'cy']],
  },
  {
    name: 'replace nested object then write through a $snapshot',
    app: `export function App(){const state={user:{name:'ann'}};const old=$snapshot(state.user);
      return <main><output id="out">{state.user.name}</output>
        <button id="a" onClick={()=>{state.user={name:'bob'};}}>r</button>
        <button id="b" onClick={()=>{old.name='stale';}}>old</button>
        <button id="c" onClick={()=>{state.user.name='cy';}}>deep</button></main>;}`,
    initial: 'ann',
    steps: [['a', 'bob'], ['b', 'bob'], ['c', 'cy']],
  },
  {
    name: 'write after await in handler',
    app: `export function App(){let count=0;
      return <main><output id="out">{count}</output>
        <button id="a" onClick={async()=>{await null;count++;}}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'in-place sort and reverse',
    app: `export function App(){const xs=[3,1,2];
      return <main><output id="out">{xs.join(',')}</output>
        <button id="a" onClick={()=>xs.sort()}>sort</button>
        <button id="b" onClick={()=>xs.reverse()}>rev</button></main>;}`,
    initial: '3,1,2',
    steps: [['a', '1,2,3'], ['b', '3,2,1']],
  },
  {
    name: 'Object.assign merge',
    app: `export function App(){const s={a:1,b:1};
      return <main><output id="out">{s.a+s.b}</output>
        <button id="a" onClick={()=>Object.assign(s,{a:10})}>m</button></main>;}`,
    initial: '2',
    steps: [['a', '11']],
  },
  {
    name: 'handler table indirection',
    app: `export function App(){let count=0;const handlers={inc:()=>{count++;}};
      return <main><output id="out">{count}</output>
        <button id="a" onClick={handlers.inc}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'derived through local function call',
    app: `export function App(){let count=1;function doubled(){return count*2;}
      return <main><output id="out">{doubled()}</output>
        <button id="a" onClick={()=>count++}>+</button></main>;}`,
    initial: '2',
    steps: [['a', '4']],
  },
  {
    name: 'opaque external emitter callback',
    modules: {
      './bus.ts': `type Fn=()=>void;const subs:Fn[]=[];
        export const bus={on(f:Fn){subs.push(f);},emit(){for(const f of subs)f();}};`,
    },
    app: `import {bus} from './bus';
      export function App(){let hits=0;bus.on(()=>{hits++;});
      return <main><output id="out">{hits}</output>
        <button id="a" onClick={()=>bus.emit()}>emit</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'module let reassigned with spread',
    modules: {
      './store.ts': `export let settings={theme:'light',size:1};
        export function toggle(){settings={...settings,theme:settings.theme==='light'?'dark':'light'};}`,
    },
    app: `import {settings,toggle} from './store';
      export function App(){return <main><output id="out">{settings.theme}</output>
        <button id="a" onClick={toggle}>t</button></main>;}`,
    initial: 'light',
    steps: [['a', 'dark'], ['a', 'light']],
  },
  {
    name: 'array length truncation',
    app: `export function App(){const xs=[1,2,3];
      return <main><output id="out">{xs.length}</output>
        <button id="a" onClick={()=>{xs.length=0;}}>clear</button></main>;}`,
    initial: '3',
    steps: [['a', '0']],
  },
  {
    name: 'delete property and Object.keys',
    app: `export function App(){const o:Record<string,number>={a:1,b:2};
      return <main><output id="out">{Object.keys(o).join(',')}</output>
        <button id="a" onClick={()=>{delete o.a;}}>del</button>
        <button id="b" onClick={()=>{o.z=9;}}>add</button></main>;}`,
    initial: 'a,b',
    steps: [['a', 'b'], ['b', 'b,z']],
  },
  {
    name: 'destructuring swap of array items',
    app: `export function App(){const xs=['a','b'];
      return <main><output id="out">{xs.join('')}</output>
        <button id="a" onClick={()=>{[xs[0],xs[1]]=[xs[1],xs[0]];}}>swap</button></main>;}`,
    initial: 'ab',
    steps: [['a', 'ba'], ['a', 'ab']],
  },
  {
    name: 'conditional source selection in list',
    app: `export function App(){const a=['x'];const b=['y','z'];let useA=true;
      return <main><output id="out">{(useA?a:b).map(v=><span key={v}>{v}</span>)}</output>
        <button id="a" onClick={()=>{useA=!useA;}}>sw</button>
        <button id="b" onClick={()=>{b.push('w');}}>push</button></main>;}`,
    initial: 'x',
    steps: [['a', 'yz'], ['b', 'yzw'], ['a', 'x']],
  },
  {
    name: 'imperative loop building JSX array',
    app: `export function App(){const xs=[1,2];
      const rows=[];for(const x of xs)rows.push(<i key={x}>{x}</i>);
      return <main><output id="out">{rows}</output>
        <button id="a" onClick={()=>xs.push(3)}>push</button></main>;}`,
    initial: '12',
    steps: [['a', '123']],
  },
  {
    name: 'JSON round-trip clone then reassign',
    app: `export function App(){let doc={n:1};
      return <main><output id="out">{doc.n}</output>
        <button id="a" onClick={()=>{const c=JSON.parse(JSON.stringify(doc));c.n++;doc=c;}}>+</button></main>;}`,
    initial: '1',
    steps: [['a', '2'], ['a', '3']],
  },
  {
    name: 'mutation via array element alias in loop',
    app: `export function App(){const items=[{v:1},{v:2}];
      return <main><output id="out">{items.map(i=>i.v).join(',')}</output>
        <button id="a" onClick={()=>{for(const it of items)it.v*=10;}}>x10</button></main>;}`,
    initial: '1,2',
    steps: [['a', '10,20']],
  },
  {
    name: 'prop callback mutating parent state',
    modules: {
      './Child.tsx': `export function Child({onPick}:{onPick:(n:number)=>void}){
        return <button id="a" onClick={()=>onPick(7)}>pick</button>;}`,
    },
    app: `import {Child} from './Child';
      export function App(){const state={picked:0};
      return <main><output id="out">{state.picked}</output><Child onPick={n=>{state.picked=n;}}/></main>;}`,
    initial: '0',
    steps: [['a', '7']],
  },
  {
    name: 'child mutates object prop it received',
    modules: {
      './Child.tsx': `export function Child({model}:{model:{n:number}}){
        return <button id="a" onClick={()=>{model.n++;}}>+</button>;}`,
    },
    app: `import {Child} from './Child';
      export function App(){const model={n:0};
      return <main><output id="out">{model.n}</output><Child model={model}/></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'state stored inside closure-held array (stack)',
    modules: {
      './history.ts': `const stack:string[]=['start'];
        export const history={push(s:string){stack.push(s);},pop(){stack.pop();},get top(){return stack[stack.length-1];}};`,
    },
    app: `import {history} from './history';
      export function App(){return <main><output id="out">{history.top}</output>
        <button id="a" onClick={()=>history.push('next')}>push</button>
        <button id="b" onClick={()=>history.pop()}>pop</button></main>;}`,
    initial: 'start',
    steps: [['a', 'next'], ['b', 'start']],
  },
  {
    name: 'class private field via method',
    modules: {
      './toggle.ts': `export class Toggle{#on=false;flip(){this.#on=!this.#on;}get label(){return this.#on?'on':'off';}}`,
    },
    app: `import {Toggle} from './toggle';
      export function App(){const t=new Toggle();
      return <main><output id="out">{t.label}</output>
        <button id="a" onClick={()=>t.flip()}>f</button></main>;}`,
    initial: 'off',
    steps: [['a', 'on'], ['a', 'off']],
  },
  {
    name: 'Date object mutation',
    app: `export function App(){const d=new Date(2020,0,1);
      return <main><output id="out">{d.getFullYear()}</output>
        <button id="a" onClick={()=>d.setFullYear(2021)}>y</button></main>;}`,
    initial: '2020',
    steps: [['a', '2021']],
  },
  {
    name: 'recursive tree component',
    modules: {
      './Tree.tsx': `type Node={id:number;label:string;kids:Node[]};
        export function Tree({node}:{node:Node}){return <span>{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    },
    app: `import {Tree} from './Tree';
      export function App(){const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      return <main><output id="out"><Tree node={root}/></output>
        <button id="a" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}>add</button>
        <button id="b" onClick={()=>{root.kids[0].label='A';}}>rename</button></main>;}`,
    initial: 'ra',
    steps: [['a', 'rab'], ['b', 'rAb']],
  },
  {
    name: 'realistic undo: $snapshot of a reference',
    app: `export function App(){const state={user:{name:'ann'}};const snapshot=$snapshot(state.user);
      return <main><output id="out">{state.user.name}</output>
        <button id="a" onClick={()=>{state.user={name:'bob'};}}>edit</button>
        <button id="b" onClick={()=>{state.user=snapshot;}}>undo</button></main>;}`,
    initial: 'ann',
    steps: [['a', 'bob'], ['b', 'ann']],
  },
  {
    name: 'handler table via arrow wrapper (workaround)',
    app: `export function App(){let count=0;const handlers={inc:()=>{count++;}};
      return <main><output id="out">{count}</output>
        <button id="a" onClick={()=>handlers.inc()}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'class defined in same module, instance in component',
    app: `class Toggle{on=false;flip(){this.on=!this.on;}get label(){return this.on?'on':'off';}}
      export function App(){const t=new Toggle();
      return <main><output id="out">{t.label}</output>
        <button id="a" onClick={()=>t.flip()}>f</button></main>;}`,
    initial: 'off',
    steps: [['a', 'on'], ['a', 'off']],
  },
  {
    name: 'npm lodash set (deep path, mutation inside library)',
    app: `import {set} from 'lodash-es';
      export function App(){const state={user:{name:'ann'}};
      return <main><output id="out">{state.user.name}</output>
        <button id="a" onClick={()=>set(state,'user.name','zed')}>set</button></main>;}`,
    initial: 'ann',
    steps: [['a', 'zed']],
  },
  {
    name: 'npm lodash remove (in-place array mutation)',
    app: `import {remove} from 'lodash-es';
      export function App(){const xs=[1,2,3];
      return <main><output id="out">{xs.join(',')}</output>
        <button id="a" onClick={()=>{remove(xs,x=>x>1);}}>rm</button></main>;}`,
    initial: '1,2,3',
    steps: [['a', '1']],
  },
  {
    name: 'npm lodash merge into module state',
    modules: { './prefs.ts': `export const prefs={theme:{mode:'light'}};` },
    app: `import {merge} from 'lodash-es';import {prefs} from './prefs';
      export function App(){return <main><output id="out">{prefs.theme.mode}</output>
        <button id="a" onClick={()=>{merge(prefs,{theme:{mode:'dark'}});}}>m</button></main>;}`,
    initial: 'light',
    steps: [['a', 'dark']],
  },
  {
    name: 'npm immer produce + reassignment',
    app: `import {produce} from 'immer';
      export function App(){let doc={items:[{n:1}]};
      return <main><output id="out">{doc.items.map(i=>i.n).join(',')}</output>
        <button id="a" onClick={()=>{doc=produce(doc,d=>{d.items.push({n:2});d.items[0].n=9;});}}>p</button></main>;}`,
    initial: '1',
    steps: [['a', '9,2']],
  },
  {
    name: 'npm mitt emitter callback writes state',
    app: `import mitt from 'mitt';
      const emitter=mitt<{hit:number}>();
      export function App(){let total=0;emitter.on('hit',n=>{total+=n;});
      return <main><output id="out">{total}</output>
        <button id="a" onClick={()=>emitter.emit('hit',5)}>hit</button></main>;}`,
    initial: '0',
    steps: [['a', '5'], ['a', '10']],
  },
  {
    name: 'npm lodash debounce wraps the writer',
    app: `import {debounce} from 'lodash-es';
      export function App(){let count=0;const inc=debounce(()=>{count++;},1);
      return <main><output id="out">{count}</output>
        <button id="a" onClick={()=>inc()}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'npm zustand store read directly (state lives in library)',
    app: `import {createStore} from 'zustand/vanilla';
      const store=createStore<{count:number}>(()=>({count:0}));
      export function App(){return <main><output id="out">{store.getState().count}</output>
        <button id="a" onClick={()=>store.setState(s=>({count:s.count+1}))}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'npm zustand bridged with subscribe (workaround)',
    app: `import {createStore} from 'zustand/vanilla';
      const store=createStore<{count:number}>(()=>({count:0}));
      export function App(){let count=store.getState().count;
      $cleanup(store.subscribe(s=>{count=s.count;}));
      return <main><output id="out">{count}</output>
        <button id="a" onClick={()=>store.setState(s=>({count:s.count+1}))}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'npm zustand setState deferred via setTimeout',
    app: `import {createStore} from 'zustand/vanilla';
      const store=createStore<{count:number}>(()=>({count:0}));
      export function App(){return <main><output id="out">{store.getState().count}</output>
        <button id="a" onClick={()=>{setTimeout(()=>store.setState(s=>({count:s.count+1})),0);}}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'npm zustand store in its own module, written by sibling component',
    modules: {
      './store.ts': `import {createStore} from 'zustand/vanilla';
        export const store=createStore<{count:number}>(()=>({count:0}));`,
      './Writer.tsx': `import {store} from './store';
        export function Writer(){return <button id="a" onClick={()=>store.setState(s=>({count:s.count+1}))}>+</button>;}`,
      './Reader.tsx': `import {store} from './store';
        export function Reader(){return <output id="out">{store.getState().count}</output>;}`,
    },
    app: `import {Reader} from './Reader';import {Writer} from './Writer';
      export function App(){return <main><Reader/><Writer/></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'npm zustand written through a helper module function',
    modules: {
      './store.ts': `import {createStore} from 'zustand/vanilla';
        export const store=createStore<{count:number}>(()=>({count:0}));
        export function increment(){store.setState(s=>({count:s.count+1}));}`,
    },
    app: `import {store,increment} from './store';
      export function App(){return <main><output id="out">{store.getState().count}</output>
        <button id="a" onClick={increment}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'browser global: location.hash',
    app: `export function App(){return <main><output id="out">{location.hash||'none'}</output>
        <button id="a" onClick={()=>{location.hash='#x';}}>go</button></main>;}`,
    initial: 'none',
    steps: [['a', '#x']],
  },
  {
    name: 'module state written by promise chain outside handlers',
    modules: {
      './clock.ts': `export const clock={ticks:0};
        export function startLater(){Promise.resolve().then(()=>{clock.ticks++;});}`,
    },
    app: `import {clock,startLater} from './clock';
      export function App(){return <main><output id="out">{clock.ticks}</output>
        <button id="a" onClick={()=>startLater()}>go</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'component let written from setInterval-style callback in setup',
    app: `export function App(){let ticks=0;let timer:any;
      return <main><output id="out">{ticks}</output>
        <button id="a" onClick={()=>{timer=setTimeout(()=>{ticks++;},0);}}>go</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'imported class (no private fields), instance in component',
    modules: {
      './toggle2.ts': `export class Toggle{on=false;flip(){this.on=!this.on;}get label(){return this.on?'on':'off';}}`,
    },
    app: `import {Toggle} from './toggle2';
      export function App(){const t=new Toggle();
      return <main><output id="out">{t.label}</output>
        <button id="a" onClick={()=>t.flip()}>f</button></main>;}`,
    initial: 'off',
    steps: [['a', 'on'], ['a', 'off']],
  },
  {
    name: 'imported class method writes module state read elsewhere',
    modules: {
      './log.ts': `export const entries:string[]=[];
        export class Logger{log(s:string){entries.push(s);}}`,
      './Count.tsx': `import {entries} from './log';
        export function Count(){return <output id="out">{entries.length}</output>;}`,
    },
    app: `import {Logger} from './log';import {Count} from './Count';
      export function App(){const logger=new Logger();
      return <main><Count/><button id="a" onClick={()=>logger.log('x')}>log</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'imperative loop building JSX array without keys',
    app: `export function App(){const xs=[1,2];
      const rows=[];for(const x of xs)rows.push(<i>{x}</i>);
      return <main><output id="out">{rows}</output>
        <button id="a" onClick={()=>xs.push(3)}>push</button></main>;}`,
    initial: '12',
    steps: [['a', '123']],
  },
  {
    name: 'write through a helper return value (deepest().label = x)',
    modules: {
      './doc.ts': `export const root={label:'r',kids:[{label:'a',kids:[] as any[]}]};
        function deepest(){let node:any=root;while(node.kids.length>0)node=node.kids[node.kids.length-1];return node;}
        export function renameDeep(){deepest().label='A';}`,
    },
    app: `import {root,renameDeep} from './doc';
      export function App(){return <main><output id="out">{root.kids[0].label}</output>
        <button id="a" onClick={renameDeep}>r</button></main>;}`,
    initial: 'a',
    steps: [['a', 'A']],
  },
  ...['deepest().label=\'A\';', 'const n=deepest();n.label=\'A\';'].map((write): StressCase => ({
    name: `helper write read by another component: ${write}`,
    modules: {
      './doc.ts': `export const root={label:'r',kids:[{label:'a',kids:[] as any[]}]};
        function deepest(){let node:any=root;while(node.kids.length>0)node=node.kids[node.kids.length-1];return node;}
        export function renameDeep(){${write}}`,
      './Label.tsx': `import {root} from './doc';export function Label(){return <output id="out">{root.kids[0].label}</output>;}`,
    },
    app: `import {renameDeep} from './doc';import {Label} from './Label';
      export function App(){return <main><Label/><button id="a" onClick={renameDeep}>r</button></main>;}`,
    initial: 'a',
    steps: [['a', 'A']],
  })),
  ...[
    ['handler writes a helper result', `import {deepest} from './doc';`, `()=>{deepest().label='A';}`],
    ['handler writes a find() result', `import {root} from './doc';`, `()=>{root.kids.find(k=>k.label==='a')!.label='A';}`],
    ['helper writes a find() result', `import {renameFound} from './doc';`, `renameFound`],
  ].map(([label, imports, handler]): StressCase => ({
    name: `result write read by another component: ${label}`,
    modules: {
      './doc.ts': `export const root={label:'r',kids:[{label:'a',kids:[] as any[]}]};
        export function deepest(){let node:any=root;while(node.kids.length>0)node=node.kids[node.kids.length-1];return node;}
        export function renameFound(){root.kids.find(k=>k.label==='a')!.label='A';}`,
      './Label.tsx': `import {root} from './doc';export function Label(){return <output id="out">{root.kids[0].label}</output>;}`,
    },
    app: `${imports}import {Label} from './Label';
      export function App(){return <main><Label/><button id="a" onClick={${handler}}>r</button></main>;}`,
    initial: 'a',
    steps: [['a', 'A']],
  })),
  ...[false, true].map((selfEdit): StressCase => ({
    name: `recursive: helper rename from outside (self-edit handler: ${selfEdit})`,
    modules: {
      './doc.ts': `export type Node={id:number;label:string;kids:Node[]};
        export const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[{id:2,label:'b',kids:[]}]}]};
        function deepest(){let node=root;while(node.kids.length>0)node=node.kids[node.kids.length-1];return node;}
        export function renameDeep(){deepest().label='B';}`,
      './Tree.tsx': `import type {Node} from './doc';
        export function Tree({node}:{node:Node}){return <span>{node.label}
          ${selfEdit ? `<button onClick={()=>{node.label=node.label+'!';}}></button>` : ''}
          {node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    },
    app: `import {Tree} from './Tree';import {root,renameDeep} from './doc';
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="a" onClick={renameDeep}>r</button></main>;}`,
    initial: 'rab',
    steps: [['a', 'raB']],
  })),
  {
    name: 'recursive: module-state tree edited deep from outside',
    modules: {
      './outline.ts': `export type Node={id:number;label:string;kids:Node[]};
        export const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[{id:2,label:'b',kids:[]}]}]};
        export function renameDeep(){root.kids[0].kids[0].label='B';}
        export function addDeep(){root.kids[0].kids[0].kids.push({id:3,label:'c',kids:[]});}
        export function removeMiddle(){root.kids[0].kids.splice(0,1);}`,
      './Tree.tsx': `import type {Node} from './outline';
        export function Tree({node}:{node:Node}){return <span>{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    },
    app: `import {Tree} from './Tree';import {root,renameDeep,addDeep,removeMiddle} from './outline';
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="a" onClick={renameDeep}>rename</button>
        <button id="b" onClick={addDeep}>add</button>
        <button id="c" onClick={removeMiddle}>remove</button></main>;}`,
    initial: 'rab',
    steps: [['a', 'raB'], ['b', 'raBc'], ['c', 'ra']],
  },
  {
    name: 'recursive: every depth reads shared module state directly',
    modules: {
      './selection.ts': `export const selection={id:-1};export function select(id:number){selection.id=id;}`,
      './Tree.tsx': `import {selection} from './selection';
        type Node={id:number;label:string;kids:Node[]};
        export function Tree({node}:{node:Node}){return <span>{selection.id===node.id?'*':''}{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    },
    app: `import {Tree} from './Tree';import {select} from './selection';
      const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[{id:2,label:'b',kids:[]}]}]};
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="a" onClick={()=>select(2)}>deep</button>
        <button id="b" onClick={()=>select(0)}>top</button></main>;}`,
    initial: 'rab',
    steps: [['a', 'ra*b'], ['b', '*rab']],
  },
  {
    name: 'recursive: node edits itself from its own handler',
    modules: {
      './Tree.tsx': `type Node={id:number;label:string;kids:Node[]};
        export function Tree({node}:{node:Node}){return <span>{node.label}
          <button id={'n'+node.id} onClick={()=>{node.label=node.label.toUpperCase();}}></button>
          {node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}`,
    },
    app: `import {Tree} from './Tree';
      const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[{id:2,label:'b',kids:[]}]}]};
      export function App(){return <main><output id="out"><Tree node={root}/></output></main>;}`,
    initial: 'rab',
    steps: [['n2', 'raB'], ['n0', 'RaB']],
  },
  {
    name: 'recursive: per-node collapse state through a conditional',
    modules: {
      './Tree.tsx': `type Node={id:number;label:string;kids:Node[]};
        export function Tree({node}:{node:Node}){let open=true;
          return <span>{node.label}<button id={'t'+node.id} onClick={()=>{open=!open;}}></button>
            {open ? <i>{node.kids.map(k=><Tree key={k.id} node={k}/>)}</i> : null}</span>;}`,
    },
    app: `import {Tree} from './Tree';
      const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[{id:2,label:'b',kids:[]}]}]};
      export function App(){return <main><output id="out"><Tree node={root}/></output></main>;}`,
    initial: 'rab',
    steps: [['t1', 'ra'], ['t1', 'rab'], ['t0', 'r']],
  },
  {
    name: 'recursive: mutual recursion across modules',
    modules: {
      './Folder.tsx': `import {Children} from './Children';
        export function Folder({node}:{node:any}){return <span>{node.label}<Children node={node}/></span>;}`,
      './Children.tsx': `import {Folder} from './Folder';
        export function Children({node}:{node:any}){return <i>{node.kids.map((k:any)=><Folder key={k.id} node={k}/>)}</i>;}`,
      './tree.ts': `export const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[] as any[]}]};
        export function add(){root.kids[0].kids.push({id:2,label:'b',kids:[]});}`,
    },
    app: `import {Folder} from './Folder';import {root,add} from './tree';
      export function App(){return <main><output id="out"><Folder node={root}/></output>
        <button id="a" onClick={add}>add</button></main>;}`,
    initial: 'ra',
    steps: [['a', 'rab']],
  },
  {
    name: 'recursive: component and caller in one module',
    app: `type Node={id:number;label:string;kids:Node[]};
      const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      function Tree({node}:{node:Node}){return <span>{node.label}{node.kids.map(k=><Tree key={k.id} node={k}/>)}</span>;}
      export function App(){return <main><output id="out"><Tree node={root}/></output>
        <button id="a" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}>add</button>
        <button id="b" onClick={()=>{root.kids[0].label='A';}}>rename</button></main>;}`,
    initial: 'ra',
    steps: [['a', 'rab'], ['b', 'rAb']],
  },
  {
    name: 'tree workaround: iterative flatten rendered as one list',
    app: `type Node={id:number;label:string;kids:Node[]};
      function flatten(root:Node){const out:{id:number;label:string;depth:number}[]=[];
        const stack=[{node:root,depth:0}];
        while(stack.length>0){const {node,depth}=stack.pop()!;out.push({id:node.id,label:node.label,depth});
          for(let i=node.kids.length-1;i>=0;i--)stack.push({node:node.kids[i],depth:depth+1});}
        return out;}
      export function App(){const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      const rows=flatten(root);
      return <main><output id="out">{rows.map(r=><span key={r.id}>{r.label}</span>)}</output>
        <button id="a" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}>add</button>
        <button id="b" onClick={()=>{root.kids[0].label='A';}}>rename</button></main>;}`,
    initial: 'ra',
    steps: [['a', 'rab'], ['b', 'rAb']],
  },
  {
    name: 'tree workaround: recursive flatten helper',
    app: `type Node={id:number;label:string;kids:Node[]};
      function flatten(node:Node,out:{id:number;label:string}[]=[]){out.push({id:node.id,label:node.label});
        for(const kid of node.kids)flatten(kid,out);return out;}
      export function App(){const root:Node={id:0,label:'r',kids:[{id:1,label:'a',kids:[]}]};
      const rows=flatten(root);
      return <main><output id="out">{rows.map(r=><span key={r.id}>{r.label}</span>)}</output>
        <button id="a" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}>add</button>
        <button id="b" onClick={()=>{root.kids[0].label='A';}}>rename</button></main>;}`,
    initial: 'ra',
    steps: [['a', 'rab'], ['b', 'rAb']],
  },
  {
    name: 'tree workaround: fixed-depth components (Level1 renders Level2)',
    modules: {
      './Levels.tsx': `type Node={id:number;label:string;kids:Node[]};
        export function Level2({node}:{node:Node}){return <span>{node.label}</span>;}
        export function Level1({node}:{node:Node}){return <span>{node.label}{node.kids.map(k=><Level2 key={k.id} node={k}/>)}</span>;}`,
    },
    app: `import {Level1} from './Levels';
      export function App(){const root={id:0,label:'r',kids:[{id:1,label:'a',kids:[] as any[]}]};
      return <main><output id="out">{root.label}{root.kids.map(k=><Level1 key={k.id} node={k}/>)}</output>
        <button id="a" onClick={()=>root.kids[0].kids.push({id:2,label:'b',kids:[]})}>add</button>
        <button id="b" onClick={()=>{root.kids[0].label='A';}}>rename</button></main>;}`,
    initial: 'ra',
    steps: [['a', 'rab'], ['b', 'rAb']],
  },
];
