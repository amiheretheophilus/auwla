/** Implicit writes must reach the graph before derivations are classified. */
import { expect, it } from 'bun:test';
import { classifyGraph } from '../../core/graph/classify';
import { parseModule } from '../../core/parse';
import { resolve } from '../../core/resolve';

it('classifies assignment targets in ref arrays while preserving callback parameters', () => {
  const graph = classifyGraph(resolve([parseModule('./App.tsx', `
    export function App() {
      let node;
      const nodes = {};
      const tag = node?.tagName;
      return <div ref={[node, nodes.panel, value => console.log(value)]}>{tag}</div>;
    }
  `)], {}));
  const kinds = new Map([...graph.bindings].map(([binding, node]) => [binding.name, node.kind]));
  expect(kinds.get('node')).toBe('Ref');
  expect(kinds.get('nodes')).toBe('State');
  expect(kinds.get('tag')).toBe('Derived');
  expect(kinds.get('value')).toBe('Opaque');
});

it('marks the defining module of an imported member root before propagating its derivations', () => {
  const graph = classifyGraph(resolve([
    parseModule('./nodes.ts', 'export const nodes = {};'),
    parseModule('./App.tsx', `import { nodes as elements } from './nodes';
      export function App() { const tag = elements.panel?.tagName; return <div ref={elements.panel}>{tag}</div>; }`),
  ], {}));
  const kinds = new Map([...graph.bindings].map(([binding, node]) => [binding.name, node.kind]));
  expect(kinds.get('nodes')).toBe('State');
  expect(kinds.get('elements')).toBe('State');
  expect(kinds.get('tag')).toBe('Derived');
});
