import { describe, expect, it } from 'bun:test';
import { classifyGraph } from '../graph/classify';
import { parseModule } from '../parse';
import { resolve } from '../resolve';
import { emitDom } from '../emit/dom';
import { printJavaScript } from '../emit/print';
import { planModules } from '.';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';

function inspect(source: string) {
  const resolved = resolve([parseModule('App.tsx', source)], {});
  const original = resolved.modules[0]!.module.ast;
  const before = JSON.stringify(original);
  const graph = classifyGraph(resolved);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  return { plan, original, before, component: [...plan.components.values()][0]! };
}

describe('template planning and emission', () => {
  it('numbers nodes in runtime creation order and records root indices', () => {
    const { component } = inspect('export const App = () => <><p>one<b>two</b></p><hr /></>;');
    expect(component.template.markup).toBe('<p>one<b>two</b></p><hr>');
    expect(component.template.roots).toEqual([3, 4]);
    expect(component.template.nodes.map((node) => node.kind)).toEqual(['text', 'text', 'element', 'element', 'element']);
  });

  it('merges static text across fragments but separates expression sites', () => {
    const { component } = inspect('export const App = () => <p>one<>two</>{1}{2}end</p>;');
    expect(component.template.markup).toBe('<p>onetwo<!----><!---->end</p>');
    expect(component.sites.map((site) => site.node)).toEqual([1, 2]);
  });

  it('records parent attributes before child expressions independently of node numbering', () => {
    const { component } = inspect(`export const App = () => <main title={parentValue}><p title={childValue}>{textValue}</p></main>;`);
    expect(component.sites.map((site) => site.kind)).toEqual(['attribute', 'attribute', 'text']);
    expect(component.sites.map((site) => site.node)).toEqual([2, 1, 0]);
  });

  it('uses direct creation for trees the HTML parser would rearrange', () => {
    for (const markup of [
      '<table><tr><td>x</td></tr></table>',
      '<p><span><div>x</div></span></p>',
      '<button><button>x</button></button>',
      '<svg><foreignObject><div>x</div></foreignObject></svg>',
      '<custom-element />',
    ]) {
      expect(inspect(`export const App = () => ${markup};`).component.template.markup).toBeNull();
    }
  });

  it('keeps repeated attributes in evaluation order', () => {
    const { component } = inspect(`export const App = () => <div id={first} id="last" />;`);
    expect(component.sites.map((site) => site.kind)).toEqual(['attribute', 'attribute']);
    expect(component.template.markup).toBe('<div></div>');
  });

  it('uses graph dependencies for site reactivity, without treating callback creation as invocation', () => {
    const { component } = inspect(`export function App() {
      let count = 0;
      const label = 'count';
      return <button onClick={() => count++} title={label}>{count}</button>;
    }`);
    expect(component.sites.map((site) => [site.kind, site.reactive])).toEqual([
      ['event', false], ['attribute', false], ['text', true],
    ]);
  });

  it('emits a new tree, preserves directives and exports, and emits no exception wrappers or JSX', () => {
    const source = `'use client'; export const App = () => <main><p>Hello</p>{'world'}</main>;`;
    const { plan, original, before } = inspect(source);
    const emitted = emitDom(plan, { runtimePath: '@memoized-dom/runtime/testing' });
    const code = printJavaScript(emitted, 'App.tsx', source);
    const parsed = parse(code, { lang: 'js', sourceType: 'module' });
    expect(parsed.diagnostics).toEqual([]);
    expect(code).toMatch(/^["']use client["'];/);
    expect(code).toContain('export const App');
    expect(findAll(emitted, ['JSXElement', 'JSXFragment', 'TryStatement'])).toHaveLength(0);
    expect(JSON.stringify(original)).toBe(before);
    expect(emitted).not.toBe(original);
  });
});

describe('primitive text sites', () => {
  it('writes text directly only when the syntax guarantees a primitive', () => {
    const source = `export function App() {
      let count = 0;
      let label = 'x';
      return <p onClick={() => count++}>{count + 1}{\`n\${count}\`}{count > 1 ? 'many' : 'few'}{!count}{label}{count && label}</p>;
    }`;
    const { plan, component } = inspect(source);
    const texts = component.sites.filter((site) => site.kind === 'text');
    expect(texts.map((site) => site.primitive)).toEqual([true, true, true, true, false, false]);
    const code = printJavaScript(emitDom(plan, { runtimePath: '@memoized-dom/runtime/testing' }), 'App.tsx', source);
    expect(code.match(/createValueSlot\(/g)).toHaveLength(2);
  });
});

describe('features of later phases fail with their phase', () => {
  it('rejects the ambient lifecycle calls, but not a local function with the same name', () => {
    expect(() => inspect('export function App() { $effect(() => {}); return <p />; }')).toThrow('`$effect` from Phase 7');
    expect(() => inspect('export function App() { $cleanup(() => {}); return <p />; }')).toThrow('`$cleanup` from Phase 7');
    expect(() => inspect('const $effect = (fn) => fn(); export function App() { $effect(() => {}); return <p />; }')).not.toThrow();
  });

  it('rejects value imports from the data package, including server-function clients', () => {
    expect(() => inspect(`import { $read } from '@memoized-dom/data'; export const App = () => <p />;`)).toThrow('Phase 8');
    expect(() => inspect(`import { createPageSource } from '@memoized-dom/data/internal'; export const x = 1;`)).toThrow('Phase 8');
    expect(() => inspect(`import type { Source } from '@memoized-dom/data'; export const App = () => <p />;`)).not.toThrow();
  });

  it('plans components used as callback values and direct calls', () => {
    const helper = 'function Row(n) { return <li>{n}</li>; }';
    expect(() => inspect(`${helper} export function App() { return <ul>{[1].map(Row)}</ul>; }`)).not.toThrow();
    expect(() => inspect(`${helper} export function App() { Row(1); return <ul />; }`)).not.toThrow();
  });
});

describe('keys outside a list', () => {
  it('shows an element whose key can change through a keyed value, and leaves out a key that cannot', () => {
    const { plan, component } = inspect('export function App() { let id = 1; return <main><p key={id} onClick={() => id++} /></main>; }');
    expect(component.template.markup).toBe('<main><!----></main>');
    expect(plan.values.map((value) => value.key !== null)).toEqual([true]);
    const literal = inspect(`export const App = () => <p key="x">hello</p>;`);
    expect(literal.component.template.markup).toBe('<p>hello</p>');
  });
});
