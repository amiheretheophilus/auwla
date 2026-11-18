import { describe, expect, it } from 'bun:test';
import { inspect } from '../../core/graph/test-helpers';

describe('component props', () => {
  it('classifies the props object and destructured aliases including rest', () => {
    const result = inspect(`
      function Child(props) { return <p>{props.label}</p>; }
      export function App({ label: title = 'Hi', nested: { value }, ...rest }) {
        return <Child label={title + value + rest.suffix} />;
      }`);
    for (const name of ['props', 'title', 'value', 'rest']) {
      expect(result.node(name).kind).toBe('Prop');
    }
  });

  it('keeps prop reassignment as an override candidate instead of changing its kind', () => {
    const result = inspect(`
      function App({ label }) {
        function edit() { label = 'local'; }
        const upper = label + '!';
        return <button onClick={edit}>{upper}</button>;
      }`);
    expect(result.node('label').kind).toBe('Prop');
    expect(result.node('label').takeovers).toHaveLength(1);
    expect(result.node('upper').kind).toBe('Derived');
  });

  it('does not classify helper parameters or map callback parameters as component props', () => {
    const result = inspect(`
      function scale(value) { return value * 2; }
      function App({ items }) { return <ul>{items.map(item => <li>{scale(item)}</li>)}</ul>; }`);
    expect(result.node('items').kind).toBe('Prop');
    expect(result.node('value').kind).toBe('Opaque');
    expect(result.node('item').kind).toBe('Opaque');
  });

  it('recognizes a component used through a direct alias across modules', () => {
    const result = inspect(`
      import { view as View } from './view';
      function App() { return <View label="hi" />; }`,
    { './view.tsx': 'export function view({ label }) { return <p>{label}</p>; }' });
    expect(result.node('label', './view.tsx').kind).toBe('Prop');
  });

  it('retains parameter defaults and body builders without converting props to state', () => {
    const result = inspect(`
      let fallback = 'hello';
      function change() { fallback = 'hi'; }
      function App({ label = fallback }) {
        if (!label) label = 'empty';
        return <p>{label}</p>;
      }`);
    expect(result.node('label').kind).toBe('Prop');
    expect(result.node('label').initial?.pattern?.type).toBe('ObjectPattern');
    expect(result.node('label').initial?.builders).toHaveLength(1);
    expect(result.reads('label')).toContain('fallback');
  });
});
