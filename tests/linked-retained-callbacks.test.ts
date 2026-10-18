import { expect, it } from 'bun:test';
import { compileModulesDetailed } from '@memoized-dom/compiler';

function compiled(use: string, imports = `import {receive} from './state';`) {
  return compileModulesDetailed({
    './state.ts': `export const model={name:'before'};
      export function receive(name){model.name=name;return name;}
      export function untouched(){model.name='untouched';}`,
    './barrel.ts': `export {receive as renamed} from './state';`,
    './App.tsx': `${imports}import {model} from './state';import {schedule} from 'opaque-scheduler';
      export function App(){${use}return <output>{model.name}</output>;}`,
  }).output;
}

it.each([
  [`schedule(receive);`, undefined],
  [`schedule({run:receive});`, undefined],
  [`schedule([receive]);`, undefined],
  [`new schedule(receive);`, undefined],
  [`const alias=receive;schedule(alias);`, undefined],
  [`schedule(renamed);`, `import {renamed} from './barrel';`],
  [`schedule(commands.receive);`, `import * as commands from './state';`],
])('publishes the original declaration when a linked function escapes: %s', (use, imports) => {
  const output = compiled(use, imports);
  const body = output['./state.ts']!.split('function receive')[1]!.split('function untouched')[0]!;
  expect(body).toContain('commitWrites(');
  expect(body).toContain('return ');
  // The caller retains the same function identity; no scheduler-specific shim.
  expect(output['./App.tsx']).not.toContain('Reflect.apply');
  expect(output['./state.ts']!.split('function untouched')[1]).not.toContain('commitWrites(');
});

it.each([
  `receive('direct');`,
  `function shadow(receive){schedule(receive);}shadow(()=>{});`,
  `const object={receive:()=>{}};schedule(object.receive);`,
])('does not add a declaration commit for direct calls or shadowed bindings: %s', use => {
  const output = compiled(use);
  expect(output['./state.ts']).not.toContain('commitWrites(');
});

it('terminates re-export cycles while resolving an escaped function to its origin', () => {
  const output = compileModulesDetailed({
    './state.ts': `export const model={name:'before'};export function receive(name){model.name=name;}`,
    './a.ts': `export {receive} from './b';`,
    './b.ts': `export {receive} from './state';export {receive as alias} from './a';`,
    './App.tsx': `import {receive} from './a';import {model} from './state';
      import {schedule} from 'opaque-scheduler';export function App(){schedule(receive);return <output>{model.name}</output>;}`,
  }).output;
  expect(output['./state.ts']).toContain('commitWrites(');
});

it('retains a named default-exported callback without changing its import identity', () => {
  const output = compileModulesDetailed({
    './state.ts': `export const model={name:'before'};export default function receive(name){model.name=name;}`,
    './App.tsx': `import receive,{model} from './state';import {schedule} from 'opaque-scheduler';
      export function App(){schedule(receive);return <output>{model.name}</output>;}`,
  }).output;
  expect(output['./state.ts']).toContain('commitWrites(');
  expect(output['./App.tsx']).toContain('schedule(receive)');
});
