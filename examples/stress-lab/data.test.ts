/**
 * Round 4: data layer under timing pressure ($fetch, $track, $read, $forms,
 * optimistic writes) with a scripted network. Every request waits until a
 * step resolves or fails it, so in-flight states are observable.
 *
 *   bun test --preload ./test-support/dom.ts ./examples/stress-lab/data.test.ts
 *
 * Step actions:
 *   'noop'                       observe only
 *   'click:<id>'                 click a button
 *   'ok:<url suffix>:<json>'     resolve the oldest pending request ending in suffix
 *   'fail:<url suffix>:<status>' fail it with an HTTP status
 *   'resolve:<name>' / 'reject:<name>'  settle the oldest deferred named <name>
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

interface DataCase {
  name: string;
  app: string;
  modules?: Record<string, string>;
  steps: Array<[action: string, expected: string]>;
}

interface Pending { url: string; resolve(response: Response): void }
interface Deferred { name: string; resolve(value: unknown): void; reject(error: unknown): void }

let requests: Pending[] = [];
let deferreds: Deferred[] = [];
let runtime: DataRuntime | null = null;
let previous: DataRuntime | null = null;

(globalThis as any).__defer = (name: string) => new Promise((resolve, reject) => {
  deferreds.push({ name, resolve, reject });
});

afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  document.body.replaceChildren();
  resetAccessTable();
  resetScheduler();
  if (previous !== null) setActiveDataRuntime(previous);
  runtime?.clear();
  runtime = previous = null;
  requests = [];
  deferreds = [];
});

// Response decoding and notifications cross several promise hops and timers.
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 10)); };
const read = () => document.querySelector('#out')?.textContent ?? '<missing #out>';
const json = (body: string) => new Response(body, { headers: { 'content-type': 'application/json' } });

function take<T extends { url?: string; name?: string }>(list: T[], match: (item: T) => boolean, what: string): T {
  const index = list.findIndex(match);
  if (index < 0) throw new Error(`no pending ${what}`);
  return list.splice(index, 1)[0]!;
}

async function act(action: string): Promise<void> {
  const [kind, ...rest] = action.split(':');
  const arg = rest[0] ?? '';
  const payload = rest.slice(1).join(':');
  if (kind === 'noop') return;
  if (kind === 'click') document.querySelector<HTMLElement>(`#${arg}`)!.click();
  else if (kind === 'ok') take(requests, r => r.url.endsWith(arg), `request ${arg}`).resolve(json(payload));
  else if (kind === 'fail') take(requests, r => r.url.endsWith(arg), `request ${arg}`)
    .resolve(new Response('{"message":"boom"}', { status: Number(payload), headers: { 'content-type': 'application/json' } }));
  else if (kind === 'resolve') take(deferreds, d => d.name === arg, `deferred ${arg}`).resolve(payload === '' ? undefined : JSON.parse(payload));
  else if (kind === 'reject') take(deferreds, d => d.name === arg, `deferred ${arg}`).reject(new Error('rejected'));
  else throw new Error(`unknown action ${action}`);
}

const defer = (name: string) => `(globalThis as any).__defer('${name}')`;

const cases: DataCase[] = [
  {
    name: 'd fetch: pending then payload',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending?'loading':s.n}</output></main>;}`,
    steps: [['noop', 'loading'], ['ok:/api/a:{"n":"x"}', 'x']],
  },
  {
    name: 'd fetch: input change refetches while old data stays visible',
    app: `export function App(){let id=1;const s=$fetch<{t:string}>(\`/api/s/\${id}\`);const r=$track(s);
      return <main><output id="out">{r.refreshing?'~':''}{r.pending?'loading':s.t}</output>
        <button id="next" onClick={()=>id++}>next</button></main>;}`,
    steps: [['ok:/api/s/1:{"t":"one"}', 'one'], ['click:next', '~one'], ['ok:/api/s/2:{"t":"two"}', 'two']],
  },
  {
    name: 'd track: status fields rendered as text update (static URL)',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.status}:{String(r.pending)}:{s.n}</output></main>;}`,
    steps: [['noop', 'pending:true:'], ['ok:/api/a:{"n":"x"}', 'success:false:x']],
  },
  {
    name: 'd track: status fields in a ternary update (static URL)',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending?'P':'D'}{r.status==='success'?'S':'-'}</output></main>;}`,
    steps: [['noop', 'P-'], ['ok:/api/a:{"n":"x"}', 'DS']],
  },
  {
    name: 'd track: tracker-only expression beside a separate payload read',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending?'P':'D'}<b>{s.n}</b></output></main>;}`,
    steps: [['noop', 'P'], ['ok:/api/a:{"n":"x"}', 'Dx']],
  },
  {
    name: 'd track: r.status as text beside a payload read',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.status}<b>{s.n}</b></output></main>;}`,
    steps: [['noop', 'pending'], ['ok:/api/a:{"n":"x"}', 'successx']],
  },
  {
    name: 'd track: String(r.pending) beside a payload read',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{String(r.pending)}<b>{s.n}</b></output></main>;}`,
    steps: [['noop', 'true'], ['ok:/api/a:{"n":"x"}', 'falsex']],
  },
  {
    name: 'd track: r.pending alone, no payload read anywhere',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending?'P':'D'}</output></main>;}`,
    steps: [['noop', 'P'], ['ok:/api/a:{"n":"x"}', 'D']],
  },
  {
    name: 'd track: the same tracker field read in two places',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending?'P':'D'}{r.pending?'p':'d'}</output></main>;}`,
    steps: [['noop', 'Pp'], ['ok:/api/a:{"n":"x"}', 'Dd']],
  },
  {
    name: 'd track: two different tracker fields',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending?'P':'D'}{r.refreshing?'R':'-'}</output></main>;}`,
    steps: [['noop', 'P-'], ['ok:/api/a:{"n":"x"}', 'D-']],
  },
  {
    name: 'd track: two tracker fields in one expression',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.pending||r.refreshing?'busy':'idle'}</output></main>;}`,
    steps: [['noop', 'busy'], ['ok:/api/a:{"n":"x"}', 'idle']],
  },
  {
    name: 'd track: tracker field bound to a local const',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const pending=$track(s).pending;
      return <main><output id="out">{pending?'P':'D'}</output></main>;}`,
    steps: [['noop', 'P'], ['ok:/api/a:{"n":"x"}', 'D']],
  },
  {
    name: 'd track: module-level source and tracker, component reads only the tracker',
    modules: { './source.ts': `export const s=$fetch<{n:string}>('/api/a');export const r=$track(s);` },
    app: `import {r} from './source';
      export function App(){return <main><output id="out">{r.pending?'P':'D'}</output></main>;}`,
    steps: [['noop', 'P'], ['ok:/api/a:{"n":"x"}', 'D']],
  },
  {
    name: 'd fetch: input change, no loading condition: old data stays until the swap',
    app: `export function App(){let id=1;const s=$fetch<{t:string}>(\`/api/s/\${id}\`);const r=$track(s);
      return <main><output id="out">{r.status}:{String(r.pending)}:{String(r.refreshing)}:{s.t}</output>
        <button id="next" onClick={()=>id++}>next</button></main>;}`,
    steps: [
      ['ok:/api/s/1:{"t":"one"}', 'success:false:false:one'],
      ['click:next', 'success:false:true:one'],
      ['ok:/api/s/2:{"t":"two"}', 'success:false:false:two'],
    ],
  },
  {
    name: 'd fetch: an older response arriving last does not win',
    app: `export function App(){let id=1;const s=$fetch<{t:string}>(\`/api/s/\${id}\`);const r=$track(s);
      return <main><output id="out">{r.pending?'loading':s.t}</output>
        <button id="next" onClick={()=>id++}>next</button></main>;}`,
    steps: [
      ['ok:/api/s/1:{"t":"one"}', 'one'], ['click:next', 'one'], ['click:next', 'one'],
      ['ok:/api/s/3:{"t":"three"}', 'three'], ['ok:/api/s/2:{"t":"two"}', 'three'],
    ],
  },
  {
    name: 'd fetch: error, then retry succeeds',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.error!==null?'err':r.pending?'loading':s.n}</output>
        <button id="retry" onClick={()=>r.refresh()}>retry</button></main>;}`,
    // With no data yet, a retry is an initial load again.
    steps: [['fail:/api/a:503', 'err'], ['click:retry', 'loading'], ['ok:/api/a:{"n":"x"}', 'x']],
  },
  {
    name: 'd fetch: a refresh while one is in flight joins it',
    app: `export function App(){const s=$fetch<{n:string}>('/api/a');const r=$track(s);
      return <main><output id="out">{r.refreshing?'~':''}{s.n}</output>
        <button id="refresh" onClick={()=>r.refresh()}>r</button></main>;}`,
    steps: [
      ['ok:/api/a:{"n":"first"}', 'first'], ['click:refresh', '~first'], ['click:refresh', '~first'],
      ['ok:/api/a:{"n":"latest"}', 'latest'],
    ],
  },
  {
    name: 'd fetch: rows each fetch their own detail; a new row fetches',
    modules: {
      './Row.tsx': `export function Row({id}:{id:number}){const d=$fetch<{n:string}>(\`/api/item/\${id}\`);const r=$track(d);
        return <i>{r.pending?'.':d.n}</i>;}`,
    },
    app: `import {Row} from './Row';
      export function App(){const ids=[1,2];
      return <main><output id="out">{ids.map(id=><Row key={id} id={id}/>)}</output>
        <button id="add" onClick={()=>ids.push(3)}>add</button></main>;}`,
    steps: [
      ['ok:/api/item/1:{"n":"a"}', 'a.'], ['ok:/api/item/2:{"n":"b"}', 'ab'],
      ['click:add', 'ab.'], ['ok:/api/item/3:{"n":"c"}', 'abc'],
    ],
  },
  {
    name: 'd fetch: module source shared by two components',
    modules: {
      './source.ts': `export const user=$fetch<{n:string}>('/api/me');`,
      './A.tsx': `import {user} from './source';export function A(){return <b>{user.n}</b>;}`,
      './B.tsx': `import {user} from './source';export function B(){return <i>{user.n}</i>;}`,
    },
    app: `import {A} from './A';import {B} from './B';
      export function App(){return <main><output id="out"><A/>|<B/></output></main>;}`,
    steps: [['ok:/api/me:{"n":"z"}', 'z|z']],
  },
  {
    name: 'd read: promise pending then value',
    app: `export function App(){const user=$read(${defer('user')} as Promise<{n:string}>);const r=$track(user);
      return <main><output id="out">{r.pending?'loading':user.n}</output></main>;}`,
    steps: [['noop', 'loading'], ['resolve:user:{"n":"ada"}', 'ada']],
  },
  {
    name: 'd read: rejected promise surfaces an error',
    app: `export function App(){const user=$read(${defer('user')} as Promise<{n:string}>);const r=$track(user);
      return <main><output id="out">{r.error!==null?'err':r.pending?'loading':user.n}</output></main>;}`,
    steps: [['reject:user', 'err']],
  },
  {
    name: 'd read: refresh re-invokes the loader',
    modules: { './api.ts': `export function loadUser(){return ${defer('user')} as Promise<{n:string}>;}` },
    app: `import {loadUser} from './api';
      export function App(){const user=$read(loadUser());const r=$track(user);
      return <main><output id="out">{r.pending?'loading':user.n}</output>
        <button id="refresh" onClick={()=>r.refresh()}>r</button></main>;}`,
    steps: [['resolve:user:{"n":"one"}', 'one'], ['click:refresh', 'one'], ['resolve:user:{"n":"two"}', 'two']],
  },
  {
    name: 'd read: argument change re-runs the loader',
    modules: { './api.ts': `export function loadUser(id:number){return (globalThis as any).__defer('user'+id) as Promise<{n:string}>;}` },
    app: `import {loadUser} from './api';
      export function App(){let id=1;const user=$read(loadUser(id));const r=$track(user);
      return <main><output id="out">{r.pending?'loading':user.n}</output>
        <button id="next" onClick={()=>id++}>next</button></main>;}`,
    steps: [['resolve:user1:{"n":"one"}', 'one'], ['click:next', 'one'], ['resolve:user2:{"n":"two"}', 'two']],
  },
  {
    name: 'd read: an older promise settling last does not win',
    modules: { './api.ts': `export function loadUser(id:number){return (globalThis as any).__defer('user'+id) as Promise<{n:string}>;}` },
    app: `import {loadUser} from './api';
      export function App(){let id=1;const user=$read(loadUser(id));const r=$track(user);
      return <main><output id="out">{r.pending?'loading':user.n}</output>
        <button id="next" onClick={()=>id++}>next</button></main>;}`,
    steps: [
      ['resolve:user1:{"n":"one"}', 'one'], ['click:next', 'one'], ['click:next', 'one'],
      ['resolve:user3:{"n":"three"}', 'three'], ['resolve:user2:{"n":"two"}', 'three'],
    ],
  },
  {
    name: 'd read: separately bound promise, then refresh',
    modules: { './api.ts': `export function loadUser(){return ${defer('user')} as Promise<{n:string}>;}` },
    app: `import {loadUser} from './api';
      export function App(){const promise=loadUser();const user=$read(promise);const r=$track(user);
      return <main><output id="out">{r.pending?'loading':user.n}</output>
        <button id="refresh" onClick={()=>r.refresh()}>r</button></main>;}`,
    steps: [['resolve:user:{"n":"one"}', 'one'], ['click:refresh', 'one'], ['resolve:user:{"n":"two"}', 'two']],
  },
  {
    name: 'd read: module-level read shared by two components',
    modules: {
      './source.ts': `export const user=$read(${defer('me')} as Promise<{n:string}>);`,
      './A.tsx': `import {user} from './source';export function A(){return <b>{user.n}</b>;}`,
      './B.tsx': `import {user} from './source';export function B(){return <i>{user.n}</i>;}`,
    },
    app: `import {A} from './A';import {B} from './B';
      export function App(){return <main><output id="out"><A/>|<B/></output></main>;}`,
    steps: [['resolve:me:{"n":"z"}', 'z|z']],
  },
  {
    name: 'd read: optimistic edit of read data, then the real value',
    modules: { './api.ts': `export function loadUser(){return ${defer('user')} as Promise<{n:string}>;}` },
    app: `import {loadUser} from './api';
      export function App(){const user=$read(loadUser());const r=$track(user);
      return <main><output id="out">{r.pending?'loading':user.n}</output>
        <button id="rename" onClick={()=>{user.n='local';}}>edit</button>
        <button id="refresh" onClick={()=>r.refresh()}>r</button></main>;}`,
    steps: [
      ['resolve:user:{"n":"server"}', 'server'], ['click:rename', 'local'],
      ['click:refresh', 'local'], ['resolve:user:{"n":"fresh"}', 'fresh'],
    ],
  },
  // Resolved values edited locally, passed through props, then replaced by a
  // newer server version (refresh stands in for a live update here).
  ...((): DataCase[] => {
    const api = { './api.ts': `export function loadNotes(){return ${defer('notes')} as Promise<{id:number;text:string}[]>;}` };
    const list = (child: string) => `import {loadNotes} from './api';import {Note} from './Note';
      export function App(){const notes=$read(loadNotes());const r=$track(notes);
      return <main><output id="out">{r.pending?'loading':notes.map(n=><Note key={n.id} note={n}/>)}</output>
        <button id="refresh" onClick={()=>r.refresh()}>r</button>${child}</main>;}`;
    const v1 = 'resolve:notes:[{"id":1,"text":"a"}]';
    const v2 = 'resolve:notes:[{"id":1,"text":"b"}]';
    return [
      {
        name: 'd resolved: child displays a prop field; a new version replaces it',
        modules: { ...api, './Note.tsx': `export function Note({note}:{note:{text:string}}){return <i>{note.text}</i>;}` },
        app: list(''),
        steps: [[v1, 'a'], ['click:refresh', 'a'], [v2, 'b']],
      },
      {
        name: 'd resolved: child edits the prop object locally, then a new version arrives',
        modules: { ...api, './Note.tsx': `export function Note({note}:{note:{id:number;text:string}}){
          return <i>{note.text}<button id={'edit'+note.id} onClick={()=>{note.text='local';}}></button></i>;}` },
        app: list(''),
        steps: [[v1, 'a'], ['click:edit1', 'local'], ['click:refresh', 'local'], [v2, 'b']],
      },
      // A written `let` copy is local state set once (docs/05-data.md, "Editing a copy").
      {
        name: 'd resolved: local copy keeps its value when a new version arrives',
        modules: { ...api, './Note.tsx': `export function Note({note}:{note:{id:number;text:string}}){
          let text=note.text;
          return <i>{note.text}/{text}<button id={'type'+note.id} onClick={()=>{text='typed';}}></button></i>;}` },
        app: list(''),
        steps: [[v1, 'a/a'], ['click:refresh', 'a/a'], [v2, 'b/a']],
      },
      {
        name: 'd resolved: typed edits survive a new version arriving',
        modules: { ...api, './Note.tsx': `export function Note({note}:{note:{id:number;text:string}}){
          let text=note.text;
          return <i>{note.text}/{text}<button id={'type'+note.id} onClick={()=>{text='typed';}}></button></i>;}` },
        app: list(''),
        steps: [[v1, 'a/a'], ['click:type1', 'a/typed'], ['click:refresh', 'a/typed'], [v2, 'b/typed']],
      },
      {
        name: 'd resolved: the Notes pattern re-seeds on entering edit mode',
        modules: { ...api, './Note.tsx': `export function Note({note}:{note:{id:number;text:string}}){
          let editing=false;let text=note.text;
          return <i>{editing?'['+text+']':note.text}
            <button id={'open'+note.id} onClick={()=>{text=note.text;editing=true;}}></button>
            <button id={'type'+note.id} onClick={()=>{text='typed';}}></button>
            <button id={'close'+note.id} onClick={()=>{editing=false;}}></button></i>;}` },
        app: list(''),
        steps: [
          [v1, 'a'], ['click:open1', '[a]'], ['click:type1', '[typed]'], ['click:close1', 'a'],
          ['click:refresh', 'a'], [v2, 'b'], ['click:open1', '[b]'],
        ],
      },
    ];
  })(),
  {
    name: 'd optimistic: failed vote rolls back',
    app: `export function App(){const story={votes:0};
      function vote(){const request=$track($read(${defer('vote')}));story.votes++;
        request.onError(()=>{story.votes--;});}
      return <main><output id="out">{story.votes}</output><button id="vote" onClick={vote}>+</button></main>;}`,
    steps: [['click:vote', '1'], ['reject:vote', '0']],
  },
  {
    name: 'd optimistic: overlapping votes roll back only the failed attempt',
    app: `export function App(){const story={votes:0};const pending=new Set<string>();
      function vote(){const request=$track($read(${defer('vote')}));pending.add(request.id);story.votes++;
        request.onSuccess((_r,id)=>{pending.delete(id);});
        request.onError((_e,id)=>{if(pending.delete(id))story.votes--;});}
      return <main><output id="out">{story.votes}</output><button id="vote" onClick={vote}>+</button></main>;}`,
    steps: [['click:vote', '1'], ['click:vote', '2'], ['resolve:vote', '2'], ['reject:vote', '1']],
  },
  {
    name: 'd forms: pending while the action runs',
    app: `export function App(){const form=$forms(async(_fields:FormData)=>{await ${defer('save')};});
      return <main><output id="out">{form.pending?'saving':'idle'}</output>
        <form onSubmit={form.submit}><input name="m"/><button id="send" type="submit">send</button></form></main>;}`,
    steps: [['click:send', 'saving'], ['resolve:save', 'idle']],
  },
  {
    name: 'd forms: a failed submission exposes an error',
    app: `export function App(){const form=$forms(async(_fields:FormData)=>{await ${defer('save')};});
      return <main><output id="out">{form.pending?'saving':form.errors.length}</output>
        <form onSubmit={form.submit}><button id="send" type="submit">send</button></form></main>;}`,
    steps: [['click:send', 'saving'], ['reject:save', '1']],
  },
  {
    name: 'd forms: double submit stays pending until both settle',
    app: `export function App(){const form=$forms(async(_fields:FormData)=>{await ${defer('save')};});
      return <main><output id="out">{form.pending?'saving':'idle'}</output>
        <form onSubmit={form.submit}><button id="send" type="submit">send</button></form></main>;}`,
    steps: [['click:send', 'saving'], ['click:send', 'saving'], ['resolve:save', 'saving'], ['resolve:save', 'idle']],
  },
  // Conduit port: a feed row passed down two component levels.
  ...(['direct', 'in a ternary'] as const).map((shape): DataCase => ({
    name: `d6 rows: a projected row passed through two components (${shape})`,
    modules: { './Preview.tsx': `type Item={id:number;who:{name:string}};
      export function Author({item}:{item:Item}){return <i>{item.who.name}</i>;}
      export function Preview({item}:{item:Item}){return <b><Author item={item}/></b>;}` },
    app: `import {Preview} from './Preview';
      export function App(){const feed=$read(${defer('feed')} as Promise<{items:{id:number;who:{name:string}}[]}>);
      return <main><output id="out">${shape === 'direct'
        ? '{feed.items.map(item=><Preview key={item.id} item={item}/>)}'
        : "{feed.items.length===0?<p>none</p>:feed.items.map(item=><Preview key={item.id} item={item}/>)}"}</output></main>;}`,
    steps: [['resolve:feed:{"items":[{"id":1,"who":{"name":"ada"}}]}', 'ada']],
  })),
  {
    name: 'd6 props: one component receives a source from one caller and a plain row from another',
    modules: { './Author.tsx': `export function Author({item}:{item:{who:{name:string}}}){return <i>{item.who.name}</i>;}
      export function Row({item}:{item:{who:{name:string}}}){return <b><Author item={item}/></b>;}` },
    app: `import {Author,Row} from './Author';
      export function App(){const one=$read(${defer('one')} as Promise<{who:{name:string}}>);
        const rows=[{id:1,who:{name:'row'}}];
        return <main><output id="out"><Author item={one}/>{rows.map(row=><Row key={row.id} item={row}/>)}</output></main>;}`,
    steps: [['resolve:one:{"who":{"name":"src"}}', 'srcrow']],
  },
  // Round 5: overlapping submissions settling out of order.
  {
    name: 'd5 forms: a later submission finishing first; the earlier failure rolls back only its own vote',
    app: `export function App(){const story={votes:0};const pending=new Set<string>();let n=0;
      const form=$forms((_fields:FormData)=>{const request=$track(form);pending.add(request.id);story.votes++;
        request.onSuccess((_r,id)=>{pending.delete(id);});
        request.onError((_e,id)=>{if(pending.delete(id))story.votes--;});
        return (globalThis as any).__defer('save'+(++n));});
      return <main><output id="out">{story.votes+'/'+(form.pending?'p':'i')}</output>
        <form onSubmit={form.submit}><button id="send" type="submit">send</button></form></main>;}`,
    steps: [['click:send', '1/p'], ['click:send', '2/p'], ['resolve:save2', '2/p'], ['reject:save1', '1/i']],
  },
  {
    name: 'd5 forms: an older submission failing after a newer one succeeded shows no error',
    app: `export function App(){let n=0;const form=$forms((_fields:FormData)=>(globalThis as any).__defer('save'+(++n)));
      return <main><output id="out">{form.pending?'p':'errors:'+form.errors.length}</output>
        <form onSubmit={form.submit}><button id="send" type="submit">send</button></form></main>;}`,
    steps: [['click:send', 'p'], ['click:send', 'p'], ['resolve:save2', 'p'], ['reject:save1', 'errors:0']],
  },
  {
    name: 'd5 forms: a schema failure reports the field and never runs the action',
    app: `const schema={'~standard':{version:1,vendor:'lab',validate:(value:any)=>value.m
        ?{value}:{issues:[{message:'required',path:['m']}]}}} as any;
      export function App(){let calls=0;const form=$forms({schema,action:(_fields:any)=>{calls++;return (globalThis as any).__defer('save');}});
      return <main><output id="out">{calls+':'+form.errors.map(e=>e.kind+'@'+(e.path??[]).join('.')).join(',')}</output>
        <form onSubmit={form.submit}><input name="m"/><button id="send" type="submit">send</button></form></main>;}`,
    steps: [['click:send', '0:parse@m']],
  },
];

for (const [index, testCase] of cases.entries()) {
  it(testCase.name, async () => {
    // Module ids are runtime identities (factories, access tables), so each
    // case gets its own folder of ids, as separate apps would.
    const prefix = `./c${index}/`;
    const output = compileModules(Object.fromEntries(
      Object.entries({ './App.tsx': testCase.app, ...testCase.modules })
        .map(([id, source]) => [prefix + id.slice(2), source])),
      // Same runtime instance as the synchronous scheduler installed below.
      { runtimePath: '@memoized-dom/runtime/testing' });
    const directory = join(import.meta.dirname, 'out', 'data');
    for (const [file, code] of Object.entries(output)) {
      mkdirSync(join(directory, file, '..'), { recursive: true });
      writeFileSync(join(directory, file), code);
    }
    // Install the scripted network before import: module-level sources start then.
    runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) => new Promise<Response>(resolve => {
        requests.push({ url: String(input), resolve });
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    const { App } = await import(pathToFileURL(join(directory, prefix, 'App.tsx')).href);
    setScheduler(run => run());
    document.body.append(App('App', null));
    await settle();

    const observed: string[] = [];
    const expected: string[] = [];
    for (const [action, value] of testCase.steps) {
      await act(action);
      await settle();
      observed.push(`${action} → ${read()}`);
      expected.push(`${action} → ${value}`);
    }
    expect(observed).toEqual(expected);
  });
}
