/**
 * Round 2: list identity, branching, rendering edge values, effects,
 * composition, and writes through collection method results.
 * Expectations follow plain JavaScript and common JSX semantics.
 */
import type { StressCase } from './cases';

const ROWS = (items: string) => `const items=${items};
  return <main><ul id="out">{items.map(i=><li key={i.id} class={'r'+i.id}>{i.n}</li>)}</ul>`;

export const cases: StressCase[] = [
  {
    name: 'r2 list: in-place sort keeps row DOM nodes',
    app: `export function App(){${ROWS("[{id:1,n:'b'},{id:2,n:'a'}]")}
      <button id="a" onClick={()=>items.sort((x,y)=>x.n.localeCompare(y.n))}>sort</button></main>;}`,
    initial: 'ba',
    steps: [['a', 'ab']],
    retained: '.r1',
  },
  {
    name: 'r2 list: splice from the middle keeps later rows',
    app: `export function App(){${ROWS("[{id:1,n:'a'},{id:2,n:'b'},{id:3,n:'c'}]")}
      <button id="a" onClick={()=>items.splice(1,1)}>rm</button></main>;}`,
    initial: 'abc',
    steps: [['a', 'ac']],
    retained: '.r3',
  },
  {
    name: 'r2 list: unshift keeps existing rows',
    app: `export function App(){${ROWS("[{id:1,n:'a'}]")}
      <button id="a" onClick={()=>items.unshift({id:0,n:'z'})}>add</button></main>;}`,
    initial: 'a',
    steps: [['a', 'za']],
    retained: '.r1',
  },
  {
    name: 'r2 list: row component state survives a reverse',
    modules: {
      './Row.tsx': `export function Row({item}:{item:{id:number;n:string}}){let count=0;
        return <li>{item.n}{count}<button id={'inc'+item.id} onClick={()=>count++}></button></li>;}`,
    },
    app: `import {Row} from './Row';
      export function App(){const items=[{id:1,n:'b'},{id:2,n:'a'}];
      return <main><ul id="out">{items.map(i=><Row key={i.id} item={i}/>)}</ul>
        <button id="rev" onClick={()=>items.reverse()}>rev</button></main>;}`,
    initial: 'b0a0',
    steps: [['inc1', 'b1a0'], ['rev', 'a0b1'], ['inc1', 'a0b2']],
  },
  {
    name: 'r2 list: nested inner list push',
    app: `export function App(){const groups=[{id:1,items:['x']},{id:2,items:['y']}];
      return <main><output id="out">{groups.map(g=><b key={g.id}>{g.items.map(v=><i key={v}>{v}</i>)}</b>)}</output>
        <button id="a" onClick={()=>groups[1].items.push('z')}>push</button></main>;}`,
    initial: 'xy',
    steps: [['a', 'xyz']],
  },
  {
    name: 'r2 list: derived filter shrinks when an item field changes',
    app: `export function App(){const todos=[{id:1,t:'a',done:false},{id:2,t:'b',done:false}];
      const open=todos.filter(t=>!t.done);
      return <main><output id="out">{open.map(t=><i key={t.id}>{t.t}</i>)}</output>
        <button id="a" onClick={()=>{todos[0].done=true;}}>done</button>
        <button id="b" onClick={()=>{todos[0].done=false;}}>undo</button></main>;}`,
    initial: 'ab',
    steps: [['a', 'b'], ['b', 'ab']],
  },
  {
    name: 'r2 list: derived sorted copy re-sorts after push',
    app: `export function App(){const xs=['b','c'];const sorted=[...xs].sort();
      return <main><output id="out">{sorted.join('')}</output>
        <button id="a" onClick={()=>xs.push('a')}>push</button></main>;}`,
    initial: 'bc',
    steps: [['a', 'abc']],
  },
  {
    name: 'r2 list: index keys after swap',
    app: `export function App(){const xs=['x','y'];
      return <main><output id="out">{xs.map((v,i)=><i key={i}>{v}</i>)}</output>
        <button id="a" onClick={()=>{[xs[0],xs[1]]=[xs[1],xs[0]];}}>swap</button></main>;}`,
    initial: 'xy',
    steps: [['a', 'yx']],
  },
  {
    name: 'r2 list: row handler closes over its own item',
    app: `export function App(){const items=[{id:1,count:0},{id:2,count:0}];
      return <main><output id="out">{items.map(it=><button key={it.id} id={'b'+it.id} onClick={()=>it.count++}>{it.count}</button>)}</output></main>;}`,
    initial: '00',
    steps: [['b2', '01'], ['b1', '11']],
  },
  {
    name: 'r2 list: Object.entries of a record after add/delete',
    app: `export function App(){const scores:Record<string,number>={a:1};
      return <main><output id="out">{Object.entries(scores).map(([k,v])=><i key={k}>{k}{v}</i>)}</output>
        <button id="a" onClick={()=>{scores.b=2;}}>add</button>
        <button id="b" onClick={()=>{delete scores.a;}}>del</button></main>;}`,
    initial: 'a1',
    steps: [['a', 'a1b2'], ['b', 'b2']],
  },
  {
    name: 'r2 list: grid cell toggle',
    app: `export function App(){const grid=[[0,0],[0,0]];
      return <main><output id="out">{grid.map(row=>row.join('')).join('|')}</output>
        <button id="a" onClick={()=>{grid[1][0]=1;}}>set</button></main>;}`,
    initial: '00|00',
    steps: [['a', '00|10']],
  },
  {
    name: 'r2 list: primitive array push/shift/pop sequence',
    app: `export function App(){const xs=[1,2,3];
      return <main><output id="out">{xs.map(x=><i key={x}>{x}</i>)}</output>
        <button id="a" onClick={()=>xs.shift()}>shift</button>
        <button id="b" onClick={()=>xs.push(4)}>push</button>
        <button id="c" onClick={()=>xs.pop()}>pop</button></main>;}`,
    initial: '123',
    steps: [['a', '23'], ['b', '234'], ['c', '23']],
  },
  {
    name: 'r2 branch: early return switches to the second branch',
    app: `export function App(){let loading=true;
      if(loading) return <main><output id="out">loading</output><button id="a" onClick={()=>{loading=false;}}>go</button></main>;
      return <main><output id="out">done</output></main>;}`,
    initial: 'loading',
    steps: [['a', 'done']],
  },
  {
    name: 'r2 branch: switch over a mode',
    app: `export function App(){let mode='a';
      const next=()=>{mode=mode==='a'?'b':mode==='b'?'c':'a';};
      switch(mode){
        case 'a': return <main><output id="out">A</output><button id="n" onClick={next}>n</button></main>;
        case 'b': return <main><output id="out">B</output><button id="n" onClick={next}>n</button></main>;
        default: return <main><output id="out">C</output><button id="n" onClick={next}>n</button></main>;
      }}`,
    initial: 'A',
    steps: [['n', 'B'], ['n', 'C'], ['n', 'A']],
  },
  {
    name: 'r2 render: falsy values (0, NaN render; null/false/undefined do not)',
    app: `export function App(){let n=0;
      return <main><output id="out">{n}{n && 'x'}{null}{false}{undefined}{n===1?NaN:''}</output>
        <button id="a" onClick={()=>{n=1;}}>one</button></main>;}`,
    initial: '00',
    steps: [['a', '1xNaN']],
  },
  {
    name: 'r2 render: optional chaining before and after population',
    app: `export function App(){const state={user:null as null|{name:string}};
      return <main><output id="out">{state.user?.name ?? 'anon'}</output>
        <button id="a" onClick={()=>{state.user={name:'z'};}}>set</button>
        <button id="b" onClick={()=>{state.user!.name='q';}}>rename</button></main>;}`,
    initial: 'anon',
    steps: [['a', 'z'], ['b', 'q']],
  },
  {
    name: 'r2 render: template literal over two sources',
    app: `export function App(){let first='a';let last='b';
      return <main><output id="out">{\`\${first} \${last}\`}</output>
        <button id="a" onClick={()=>{first='x';}}>f</button>
        <button id="b" onClick={()=>{last='y';}}>l</button></main>;}`,
    initial: 'a b',
    steps: [['a', 'x b'], ['b', 'x y']],
  },
  {
    name: 'r2 objects: getter/setter pair on an object literal',
    app: `export function App(){const temp={c:0,get f(){return this.c*9/5+32;},set f(v:number){this.c=(v-32)*5/9;}};
      return <main><output id="out">{temp.f}</output>
        <button id="a" onClick={()=>{temp.f=212;}}>boil</button></main>;}`,
    initial: '32',
    steps: [['a', '212']],
  },
  {
    name: 'r2 objects: subclass getter over an inherited method',
    modules: {
      './model.ts': `export class Base{n=0;inc(){this.n++;}}
        export class Child extends Base{get label(){return 'n'+this.n;}}`,
    },
    app: `import {Child} from './model';
      export function App(){const c=new Child();
      return <main><output id="out">{c.label}</output><button id="a" onClick={()=>c.inc()}>+</button></main>;}`,
    initial: 'n0',
    steps: [['a', 'n1']],
  },
  {
    name: 'r2 objects: Array.from(set) rendered',
    app: `export function App(){const s=new Set<string>();
      return <main><output id="out">{Array.from(s).join(',')||'-'}</output>
        <button id="a" onClick={()=>s.add('x')}>x</button>
        <button id="b" onClick={()=>s.add('y')}>y</button></main>;}`,
    initial: '-',
    steps: [['a', 'x'], ['b', 'x,y']],
  },
  {
    name: 'r2 collections: write through Map.get() result from a helper',
    modules: {
      './counts.ts': `export const counts=new Map<string,{n:number}>([['k',{n:0}]]);
        export function bump(){counts.get('k')!.n++;}`,
      './Show.tsx': `import {counts} from './counts';export function Show(){return <output id="out">{counts.get('k')!.n}</output>;}`,
    },
    app: `import {bump} from './counts';import {Show} from './Show';
      export function App(){return <main><Show/><button id="a" onClick={bump}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1'], ['a', '2']],
  },
  {
    name: 'r2 collections: write through WeakMap.get() result in a handler',
    app: `export function App(){const key={};const meta=new WeakMap<object,{n:number}>([[key,{n:0}]]);
      return <main><output id="out">{meta.get(key)!.n}</output>
        <button id="a" onClick={()=>{meta.get(key)!.n++;}}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'r2 effects: effect derives a second value from state',
    app: `export function App(){let count=0;let log=0;
      $effect(()=>{log=count*10;});
      return <main><output id="out">{log}</output><button id="a" onClick={()=>count++}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '10'], ['a', '20']],
  },
  {
    name: 'r2 effects: module chain of derivations across modules',
    modules: {
      './a.ts': `export let base=1;export const double=base*2;export function inc(){base++;}`,
      './b.ts': `import {double} from './a';export const quad=double*2;`,
    },
    app: `import {inc} from './a';import {quad} from './b';
      export function App(){return <main><output id="out">{quad}</output><button id="a" onClick={inc}>+</button></main>;}`,
    initial: '4',
    steps: [['a', '8'], ['a', '12']],
  },
  {
    name: 'r2 composition: two instances keep independent state',
    modules: {
      './Counter.tsx': `export function Counter({name}:{name:string}){let n=0;
        return <span>{n}<button id={name} onClick={()=>n++}></button></span>;}`,
    },
    app: `import {Counter} from './Counter';
      export function App(){return <main><output id="out"><Counter name="x"/><Counter name="y"/></output></main>;}`,
    initial: '00',
    steps: [['x', '10'], ['y', '11'], ['x', '21']],
  },
  {
    name: 'r2 composition: children slot follows parent state',
    modules: { './Card.tsx': `export function Card({children}:{children?:any}){return <section>{children}</section>;}` },
    app: `import {Card} from './Card';
      export function App(){let count=0;
      return <main><output id="out"><Card>{count}</Card></output><button id="a" onClick={()=>count++}>+</button></main>;}`,
    initial: '0',
    steps: [['a', '1']],
  },
  {
    name: 'r2 composition: spread props follow a mutated object',
    modules: { './Badge.tsx': `export function Badge({label}:{label:string}){return <b>{label}</b>;}` },
    app: `import {Badge} from './Badge';
      export function App(){const info={label:'a'};
      return <main><output id="out"><Badge {...info}/></output><button id="a" onClick={()=>{info.label='b';}}>x</button></main>;}`,
    initial: 'a',
    steps: [['a', 'b']],
  },
  {
    name: 'r2 composition: default prop value then a real value',
    modules: { './Badge.tsx': `export function Badge({label='none'}:{label?:string}){return <b>{label}</b>;}` },
    app: `import {Badge} from './Badge';
      export function App(){const state={label:undefined as string|undefined};
      return <main><output id="out"><Badge label={state.label}/></output>
        <button id="a" onClick={()=>{state.label='x';}}>set</button>
        <button id="b" onClick={()=>{state.label=undefined;}}>clear</button></main>;}`,
    initial: 'none',
    steps: [['a', 'x'], ['b', 'none']],
  },
  {
    name: 'r2 events: stopPropagation keeps the outer handler from running',
    app: `export function App(){let outer=0;
      return <main><output id="out">{outer}</output>
        <div onClick={()=>outer++}>
          <button id="stop" onClick={(e)=>e.stopPropagation()}>stop</button>
          <button id="go">go</button>
        </div></main>;}`,
    initial: '0',
    steps: [['stop', '0'], ['go', '1']],
  },
];
