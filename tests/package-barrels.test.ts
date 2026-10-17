import { expect, it } from 'bun:test';
import { compileModulesDetailed, experimentalCompilePackage } from '@memoized-dom/compiler';

it('retains helper facts and component adoption through aliased named package barrels', () => {
  const packaged = experimentalCompilePackage({
    './index.ts': `const __mmd_reexport0=7;void __mmd_reexport0;
      export {Renamed as Badge,advance as bump} from './middle';export type {Counter} from './middle';`,
    './middle.ts': `export {Badge as Renamed,bump as advance,type Counter} from './impl';`,
    './impl.tsx': `export type Counter={value:number};
      export function bump(counter:Counter){counter.value++;}
      export function Badge({value}:{value:number}){return <b>{value}</b>;}`,
  }, { packageEntries: { 'barrel-ui': './index.ts' } });
  const entry = packaged.artifact.entries['barrel-ui']!;
  expect(Object.keys(entry.functions)).toEqual(['bump']);
  expect(entry.functions.bump!.parameterWrites).toContainEqual(expect.objectContaining({ index: 0, path: ['value'] }));
  expect(entry.components!.Badge!.initial?.adoption).toBe('host-v1');
  expect(packaged.output['./index.ts']).toContain('__mmd_reexport1');
  expect(packaged.output['./middle.ts']).not.toContain('Counter');
  const app = compileModulesDetailed({
    './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    './App.tsx': `import {Card} from './ui';export function App(){let value=1;return <main><Card value={value}/><button onClick={()=>value++}>Add</button></main>;}`,
    './ui.ts': `export {Badge as Card} from 'barrel-ui';`,
  }, { initialContent: true, experimentalPackageArtifacts: [packaged.artifact] });
  expect(app.initialContent).toBe(true);
  expect(app.initialRender.kind).toBe('bindings');
});

it('keeps default aliases and canonical state identities through source barrels', () => {
  const compiled = compileModulesDetailed({
    './state.ts': `export let count=0;export function increment(){count++;}export default function read(){return count;}`,
    './barrel.ts': `export {count as total,increment as inc,default as current} from './state';`,
    './App.tsx': `import {total,inc,current} from './barrel';export function App(){return <main><button onClick={inc}>Add</button><p>{total}:{current()}</p></main>;}`,
  });
  expect(compiled.metadata['./barrel.ts']!.stateExports).toContainEqual({ exported: 'total', kind: 'let', key: './state.ts#count' });
  const increment = compiled.metadata['./barrel.ts']!.functionExports.find(item => item.exported === 'inc')!;
  expect(increment.writes).toContain('./state.ts#count');
  expect(compiled.output['./barrel.ts']).toMatch(/default as __mmd_reexport\d/);
});

it('does not admit type-only re-exports into the runtime package graph', () => {
  const packaged = experimentalCompilePackage({
    './index.ts': `export type {OnlyAType} from 'types-only';export function echo(value:number){return value;}`,
  }, { packageEntries: { 'typed-barrel': './index.ts' } });
  expect(Object.keys(packaged.artifact.entries['typed-barrel']!.functions)).toEqual(['echo']);
  expect(packaged.output['./index.ts']).not.toContain('types-only');
});

it('cannot hide unsupported package module state behind a component barrel', () => {
  expect(() => experimentalCompilePackage({
    './index.ts': `export {Badge} from './impl';`,
    './impl.tsx': `let hidden=1;export function Badge(){return <button onClick={()=>hidden++}>{hidden}</button>;}`,
  }, { packageEntries: { 'unsafe-barrel': './index.ts' } })).toThrow('package module state');
});
