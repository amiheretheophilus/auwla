import type { Scenario } from './types';

/** Identical authored application source in both modes; only package metadata differs. */
export function fixture(scenario: Scenario, size: number): Record<string, string> {
  const shared = scenario === 'shared';
  const tile = shared
    ? `import {Reader} from './Reader';import {models} from './state';`
    : '';
  const model = scenario === 'fetch'
    ? `const model=$fetch<{user:{count:number}}>('/profile/'+index);`
    : shared ? '' : `const model={user:{count:0}};`;
  const target = shared ? 'models[index]' : 'model';
  return {
    ...(shared ? {
      './state.ts': `export const models=Array.from({length:${size}},()=>({user:{count:0}}));`,
      './Reader.tsx': `import {models} from './state';export function Reader({index}:{index:number}){
        return <output data-value={index}>{models[index].user.count}</output>;}`,
    } : {}),
    './Tile.tsx': `import {dset} from 'dset';${tile}
      export function Tile({index}:{index:number}){${model}
        return <section>${shared ? '<Reader index={index}/>' : '<output data-value={index}>{model.user.count}</output>'}
          <button data-change={index} onClick={()=>dset(${target},'user.count',${target}.user.count+1)}>Increment</button>
        </section>;}`,
    './App.tsx': `import {Tile} from './Tile';export function App(){
      const indices=[${Array.from({ length: size }, (_, index) => index).join(',')}];
      return <main><input id="draft"/>{indices.map(index=><Tile key={index} index={index}/>)}</main>;}`,
  };
}
