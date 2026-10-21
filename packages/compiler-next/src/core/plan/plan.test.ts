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
