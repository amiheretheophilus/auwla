/**
 * Recursive component update cost.
 *
 * A recursive <Tree> has unbounded placement depth, so shared state it reads
 * is routed through `<path>/**` readers, and data passed down as props flows
 * through the prop cascade. This runner measures both against a flattened
 * single keyed list holding the same nodes, the workaround available before
 * recursive components compiled.
 *
 *   bun run bench/recursive-tree/run.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, resetScheduler, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';

const FANOUT = Number(process.env.FANOUT ?? 4);
const DEPTH = Number(process.env.DEPTH ?? 6);
const SAMPLES = Number(process.env.SAMPLES ?? 31);

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
});
setScheduler(commit => commit());

const outline = `
  export type Node = { id: number; label: string; kids: Node[] };
  function build(id: number, depth: number): Node {
    const kids: Node[] = [];
    if (depth > 0) for (let i = 0; i < ${FANOUT}; i++) kids.push(build(id * ${FANOUT} + i + 1, depth - 1));
    return { id, label: 'n', kids };
  }
  export const root: Node = build(0, ${DEPTH});
  export const selection = { id: -1 };
  export function deepest(): Node { let node = root; while (node.kids.length > 0) node = node.kids[node.kids.length - 1]; return node; }
  export function renameDeep() { const node = deepest(); node.label = node.label === 'x' ? 'y' : 'x'; }
  export function selectDeep() { selection.id = deepest().id; }
  export function selectRoot() { selection.id = root.id; }
`;
// Writes commit at compiled call sites, so every update is driven by a click.
const CONTROLS = `<button id="rename" onClick={renameDeep} /><button id="select-deep" onClick={selectDeep} /><button id="select-root" onClick={selectRoot} />`;
const CONTROL_IMPORTS = 'renameDeep, selectDeep, selectRoot';
const MAIN = "import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);";

const variants: Record<string, Record<string, string>> = {
  recursive: {
    './Tree.tsx': `import type { Node } from './outline';
      export function Tree({ node }: { node: Node }) {
        return <li>{node.label}<button data-self={node.id} onClick={() => { node.label = node.label + '!'; }} />
          <ul>{node.kids.map(kid => <Tree key={kid.id} node={kid} />)}</ul></li>;
      }`,
    './App.tsx': `import { Tree } from './Tree'; import { root, ${CONTROL_IMPORTS} } from './outline';
      export function App() { return <main>${CONTROLS}<ul><Tree node={root} /></ul></main>; }`,
  },
  flat: {
    './App.tsx': `import { root, ${CONTROL_IMPORTS}, type Node } from './outline';
      function flatten(start: Node) {
        const out: { node: Node; depth: number }[] = [];
        const stack = [{ node: start, depth: 0 }];
        while (stack.length > 0) {
          const item = stack.pop()!;
          out.push(item);
          for (let i = item.node.kids.length - 1; i >= 0; i--) stack.push({ node: item.node.kids[i], depth: item.depth + 1 });
        }
        return out;
      }
      export function App() {
        const rows = flatten(root);
        return <main>${CONTROLS}<ul>{rows.map(row => <li key={row.node.id}>{row.node.label}</li>)}</ul></main>;
      }`,
  },
  'recursive+selection': {
    './Tree.tsx': `import type { Node } from './outline'; import { selection } from './outline';
      export function Tree({ node }: { node: Node }) {
        return <li>{selection.id === node.id ? '*' : ''}{node.label}
          <ul>{node.kids.map(kid => <Tree key={kid.id} node={kid} />)}</ul></li>;
      }`,
    './App.tsx': `import { Tree } from './Tree'; import { root, ${CONTROL_IMPORTS} } from './outline';
      export function App() { return <main>${CONTROLS}<ul><Tree node={root} /></ul></main>; }`,
  },
};

const click = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!.click();

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

async function load(name: string) {
  const output = compileModules({ './main.ts': MAIN, './outline.ts': outline, ...variants[name] },
    { runtimePath: '@memoized-dom/runtime/testing' });
  const directory = join(import.meta.dirname, 'dist', name.replace('+', '-'));
  mkdirSync(directory, { recursive: true });
  for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file), code);
  const app = await import(pathToFileURL(join(directory, 'App.tsx')).href);
  const data = await import(pathToFileURL(join(directory, 'outline.ts')).href);
  return { App: app.App, data };
}

function unmountAll(): void {
  for (const id of registeredIds()) unregisterSubtree(id);
  document.body.replaceChildren();
}

/** One warm-up mount, then the median of three; the last mount stays live. */
function mount(App: (id: string, parent: null) => Node): number {
  const samples: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i > 0) unmountAll();
    const start = performance.now();
    document.body.append(App('App', null));
    if (i > 0) samples.push(performance.now() - start);
  }
  return median(samples);
}

function time(run: (sample: number) => void): number {
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    run(i);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

const nodes = (FANOUT ** (DEPTH + 1) - 1) / (FANOUT - 1);
const rows: Array<[string, string]> = [];

for (const name of ['recursive', 'flat']) {
  const { App, data } = await load(name);
  rows.push([`${name}: mount`, `${mount(App).toFixed(1)} ms`]);
  rows.push([`${name}: deep rename from outside`, `${time(() => click('rename')).toFixed(3)} ms`]);
  // An odd number of toggles leaves the deepest label at 'x'.
  if (!document.body.textContent!.includes('x')) throw new Error(`${name}: deep rename did not render`);
  if (name === 'recursive') {
    const button = document.querySelector<HTMLButtonElement>(`[data-self="${data.deepest().id}"]`)!;
    rows.push([`${name}: deep node edits itself`, `${time(() => button.click()).toFixed(3)} ms`]);
  }
  unmountAll();
}

{
  const { App } = await load('recursive+selection');
  mount(App);
  rows.push(['recursive: shared state read at every depth (** readers)',
    `${time(i => click(i % 2 === 0 ? 'select-deep' : 'select-root')).toFixed(3)} ms`]);
  if (document.body.textContent!.split('*').length !== 2) throw new Error('selection did not render exactly once');
  unmountAll();
}

resetScheduler();
console.log(`Recursive tree: ${nodes} nodes (fanout ${FANOUT}, depth ${DEPTH}), median of ${SAMPLES} updates\n`);
const width = Math.max(...rows.map(([label]) => label.length));
for (const [label, value] of rows) console.log(`${label.padEnd(width)}  ${value}`);
