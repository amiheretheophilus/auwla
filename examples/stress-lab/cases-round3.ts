/**
 * Round 3: indirection that static analysis can lose — `this`, stored
 * callbacks, nested callbacks, destructured and closed-over parameters,
 * import forms, rebinding, and getters over module state. The writer and
 * the reader are always different components so a local re-render cannot
 * hide a missed write.
 */
import type { StressCase } from './cases';

/** App with a writer button and a separate reader component. */
const split = (name: string, store: string, reader: string, writerImports: string, handler: string,
  initial: string, steps: StressCase['steps']): StressCase => ({
  name,
  modules: {
    './store.ts': store,
    './Reader.tsx': `${reader}`,
  },
  app: `${writerImports}import {Reader} from './Reader';
    export function App(){return <main><Reader/><button id="a" onClick={${handler}}>go</button></main>;}`,
  initial,
  steps,
});

const READ = (imports: string, expression: string) =>
  `${imports}export function Reader(){return <output id="out">{${expression}}</output>;}`;

const BOARD = {
  './state.ts': `export const columns=[{id:'todo',tasks:[{id:1,done:false},{id:2,done:false}]}];
    export function toggle(task:{done:boolean}){task.done=!task.done;}`,
  './Card.tsx': `import {toggle} from './state';
    export function Card({task}:{task:{id:number;done:boolean}}){return <button id={'t'+task.id} onClick={()=>toggle(task)}>{String(task.done)[0]}</button>;}`,
  './Count.tsx': `import {columns} from './state';
    export function Count(){return <output id="out">{columns[0].tasks.filter(t=>t.done).length}</output>;}`,
};
const column = (list: string) => `import {Card} from './Card';
  export function Column({column}:{column:{tasks:{id:number;done:boolean}[]}}){const visible=column.tasks.filter(t=>!t.done);
  return <section>${list}</section>;}`;
const board = (name: string, list: string): StressCase => ({
  name,
  modules: { ...BOARD, './Column.tsx': column(list) },
  app: `import {columns} from './state';import {Column} from './Column';import {Count} from './Count';
    export function App(){return <main><Count/>{columns.map(c=><Column key={c.id} column={c}/>)}</main>;}`,
  initial: '0',
  steps: [['t1', '1']],
});

export const cases: StressCase[] = [
  board('r3 row write through a derived list reaches other readers (plain list)',
    '{visible.map(task=><Card key={task.id} task={task}/>)}'),
  board('r3 row write through a derived list reaches other readers (list in a ternary)',
    "{visible.length>0?visible.map(task=><Card key={task.id} task={task}/>):'done'}"),
  {
    name: 'r3 inline row write through a derived list reaches other readers',
    modules: {
      './state.ts': `export const todos=[{id:1,done:false},{id:2,done:false}];`,
      './Count.tsx': `import {todos} from './state';export function Count(){return <output id="out">{todos.filter(t=>t.done).length}</output>;}`,
    },
    app: `import {todos} from './state';import {Count} from './Count';
      export function App(){const open=todos.filter(t=>!t.done);
      return <main><Count/><ul>{open.map(t=><li key={t.id}><button id={'t'+t.id} onClick={()=>{t.done=true;}}>x</button></li>)}</ul></main>;}`,
    initial: '0',
    steps: [['t1', '1'], ['t2', '2']],
  },
  {
    name: 'r3 list of simple row components inside a ternary branch',
    modules: { './Note.tsx': `export function Note({note}:{note:{text:string}}){return <i>{note.text}</i>;}` },
    app: `import {Note} from './Note';
      export function App(){let ready=false;const notes=[{id:1,text:'a'}];
      return <main><output id="out">{ready?notes.map(n=><Note key={n.id} note={n}/>):'loading'}</output>
        <button id="a" onClick={()=>{ready=true;}}>go</button>
        <button id="b" onClick={()=>{notes[0].text='b';}}>edit</button></main>;}`,
    initial: 'loading',
    steps: [['a', 'a'], ['b', 'b']],
  },
  {
    name: 'r3 list of simple row components inside a ternary, list replaced',
    modules: { './Note.tsx': `export function Note({note}:{note:{text:string}}){return <i>{note.text}</i>;}` },
    app: `import {Note} from './Note';
      export function App(){const state={ready:false,notes:[{id:1,text:'a'}]};
      return <main><output id="out">{state.ready?state.notes.map(n=><Note key={n.id} note={n}/>):'loading'}</output>
        <button id="a" onClick={()=>{state.ready=true;}}>go</button>
        <button id="b" onClick={()=>{state.notes=[{id:1,text:'b'}];}}>replace</button></main>;}`,
    initial: 'loading',
    steps: [['a', 'a'], ['b', 'b']],
  },
  split('r3 write through this in an object-literal method',
    `export const store={items:[] as string[],add(x:string){this.items.push(x);}};`,
    READ(`import {store} from './store';`, 'store.items.length'),
    `import {store} from './store';`, `()=>store.add('x')`, '0', [['a', '1'], ['a', '2']]),
  split('r3 callback stored now, called later by another component',
    `const listeners:(()=>void)[]=[];export const stats={hits:0};
     export function onPing(fn:()=>void){listeners.push(fn);}
     export function ping(){for(const fn of listeners)fn();}
     onPing(()=>{stats.hits++;});`,
    READ(`import {stats} from './store';`, 'stats.hits'),
    `import {ping} from './store';`, 'ping', '0', [['a', '1']]),
  split('r3 forEach callback mutates each item',
    `export const todos=[{done:false},{done:false}];
     export function completeAll(){todos.forEach(t=>{t.done=true;});}`,
    READ(`import {todos} from './store';`, "todos.filter(t=>t.done).length"),
    `import {completeAll} from './store';`, 'completeAll', '0', [['a', '2']]),
  split('r3 for...in loop writes',
    `export const flags:Record<string,boolean>={a:false,b:false};
     export function setAll(){for(const k in flags)flags[k]=true;}`,
    READ(`import {flags} from './store';`, "Object.values(flags).filter(Boolean).length"),
    `import {setAll} from './store';`, 'setAll', '0', [['a', '2']]),
  split('r3 helper with a destructured parameter',
    `export const state={user:{name:'a'}};
     function rename({user}:{user:{name:string}}){user.name='b';}
     export function go(){rename(state);}`,
    READ(`import {state} from './store';`, 'state.user.name'),
    `import {go} from './store';`, 'go', 'a', [['a', 'b']]),
  split('r3 reference stashed in another object',
    `export const state={user:{name:'a'}};
     const refs={current:state.user};
     export function go(){refs.current.name='b';}`,
    READ(`import {state} from './store';`, 'state.user.name'),
    `import {go} from './store';`, 'go', 'a', [['a', 'b']]),
  split('r3 setter closure returned by a factory',
    `export const state={v:0};
     function makeSetter(obj:{v:number}){return (v:number)=>{obj.v=v;};}
     export const setV=makeSetter(state);`,
    READ(`import {state} from './store';`, 'state.v'),
    `import {setV} from './store';`, '()=>setV(5)', '0', [['a', '5']]),
  split('r3 Object.values(...).forEach increments',
    `export const counters={a:{n:0},b:{n:0}};
     export function bumpAll(){Object.values(counters).forEach(c=>c.n++);}`,
    READ(`import {counters} from './store';`, 'counters.a.n+counters.b.n'),
    `import {bumpAll} from './store';`, 'bumpAll', '0', [['a', '2']]),
  split('r3 namespace import writer',
    `export const cart={items:[] as string[]};`,
    READ(`import {cart} from './store';`, 'cart.items.length'),
    `import * as store from './store';`, "()=>store.cart.items.push('x')", '0', [['a', '1']]),
  split('r3 namespace import reader',
    `export const cart={items:[] as string[]};export function add(){cart.items.push('x');}`,
    READ(`import * as store from './store';`, 'store.cart.items.length'),
    `import {add} from './store';`, 'add', '0', [['a', '1']]),
  split('r3 renamed export specifier',
    `const items:string[]=[];export {items as list};export function add(){items.push('x');}`,
    READ(`import {list} from './store';`, 'list.length'),
    `import {add} from './store';`, 'add', '0', [['a', '1']]),
  split('r3 default-exported store object',
    `const store={count:0};export default store;export function inc(){store.count++;}`,
    READ(`import store from './store';`, 'store.count'),
    `import {inc} from './store';`, 'inc', '0', [['a', '1']]),
  split('r3 module let array rebound then mutated',
    `export let items:string[]=['a'];
     export function reset(){items=[];}
     export function add(){items.push('x');}`,
    READ(`import {items} from './store';`, 'items.length'),
    `import {reset,add} from './store';`, '()=>{reset();add();add();}', '1', [['a', '2']]),
  split('r3 class getter over module state, read through an instance',
    `export const cart:number[]=[];
     class Totals{get sum(){return cart.reduce((a,b)=>a+b,0);}}
     export const totals=new Totals();
     export function add(){cart.push(5);}`,
    READ(`import {totals} from './store';`, 'totals.sum'),
    `import {add} from './store';`, 'add', '0', [['a', '5'], ['a', '10']]),
  split('r3 object-literal getter over other module state',
    `export const cart:number[]=[];
     export const totals={get sum(){return cart.reduce((a,b)=>a+b,0);}};
     export function add(){cart.push(5);}`,
    READ(`import {totals} from './store';`, 'totals.sum'),
    `import {add} from './store';`, 'add', '0', [['a', '5']]),
  split('r3 plain function over module state, called in the reader',
    `export const cart:number[]=[];
     export function sum(){return cart.reduce((a,b)=>a+b,0);}
     export function add(){cart.push(5);}`,
    READ(`import {sum} from './store';`, 'sum()'),
    `import {add} from './store';`, 'add', '0', [['a', '5']]),
  split('r3 write from a promise continuation in a helper',
    `export const job={status:'idle'};
     export function start(){job.status='running';Promise.resolve().then(()=>{job.status='done';});}`,
    READ(`import {job} from './store';`, 'job.status'),
    `import {start} from './store';`, 'start', 'idle', [['a', 'done']]),
  split('r3 write through Reflect.set and Object.defineProperty',
    `export const box:{v:number}={v:0};
     export function viaReflect(){Reflect.set(box,'v',1);}
     export function viaDefine(){Object.defineProperty(box,'v',{value:2,writable:true,enumerable:true,configurable:true});}`,
    READ(`import {box} from './store';`, 'box.v'),
    `import {viaReflect} from './store';`, 'viaReflect', '0', [['a', '1']]),
  split('r3 array fill() on module state',
    `export const cells=[0,0,0];export function fillAll(){cells.fill(1);}`,
    READ(`import {cells} from './store';`, "cells.join('')"),
    `import {fillAll} from './store';`, 'fillAll', '000', [['a', '111']]),
  split('r3 helper recursion writing module state',
    `export type N={on:boolean;kids:N[]};
     export const tree:N={on:false,kids:[{on:false,kids:[]}]};
     function turnOn(n:N){n.on=true;n.kids.forEach(turnOn);}
     export function all(){turnOn(tree);}`,
    READ(`import {tree} from './store';`, "String(tree.on)+String(tree.kids[0].on)"),
    `import {all} from './store';`, 'all', 'falsefalse', [['a', 'truetrue']]),
];
