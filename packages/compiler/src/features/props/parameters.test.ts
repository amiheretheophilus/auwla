/** Parameter mistakes from the old positional props (`parameters.ts`). */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../..';

function compile(source: string, modules: Record<string, string> = {}): void {
  compileModules({ ...modules, './App.tsx': source });
}

describe('a component used as a tag takes one props object', () => {
  it('refuses parameters after the first, and suggests destructuring them', () => {
    expect(() => compile(`
      function Row(item, sfx) { return <li>{item.label}{sfx}</li>; }
      export function App() { return <ul><Row item={{ label: 'a' }} sfx="!" /></ul>; }
    `)).toThrow('<Row> is used as a tag, so it receives one props object and its parameters after the first are always undefined. Write `function Row({ item, sfx })` to take those props.');
  });

  it('refuses them for a component imported from another module, at its own declaration', () => {
    expect(() => compile(`
      import { Row } from './Row';
      export function App() { return <ul><Row item="a" sfx="!" /></ul>; }
    `, {
      './Row.tsx': `export const Row = (item, sfx) => <li>{item}{sfx}</li>;`,
    })).toThrow(/<Row> is used as a tag[\s\S]*\(\.\/Row\.tsx:1:27\)/);
  });

  it('accepts a capitalized function that is only called, with any parameters', () => {
    expect(() => compile(`
      function Row(item, index) { return <li>{item}:{index}</li>; }
      function Label(text, count) { return <b>{text}{count}</b>; }
      export function App() { return <main><ul>{['a', 'b'].map(Row)}</ul>{Label('x', 2)}</main>; }
    `)).not.toThrow();
  });
});

describe('a component does not show its whole props object as text', () => {
  it('refuses `{value}` where value is the props object', () => {
    expect(() => compile(`
      function Count(value) { return <p>{value}</p>; }
      export function App() { return <Count value={1} />; }
    `)).toThrow('`value` is the whole props object of <Count>, so `{value}` shows "[object Object]". To take the prop named `value`, write `function Count({ value })`.');
  });

  it('accepts the props object read by field, destructured, or passed on as an attribute', () => {
    expect(() => compile(`
      function Inner({ data }) { return <p>{data.value}</p>; }
      function Count(props) { return <div><p>{props.value}</p><Inner data={props} /></div>; }
      function Badge({ value }) { return <b>{value}</b>; }
      export function App() { return <main><Count value={1} /><Badge value={2} /></main>; }
    `)).not.toThrow();
  });

  it('accepts it when the function is also called directly, or reassigns its parameter', () => {
    expect(() => compile(`
      function Label(text) { return <b>{text}</b>; }
      function Fallback(value) { value = String(value.value); return <i>{value}</i>; }
      export function App() { return <main><Label text="a" />{Label('b')}<Fallback value={1} /></main>; }
    `)).not.toThrow();
  });

  it('accepts it for an exported entry component that code outside the program may call', () => {
    expect(() => compile(`
      export function Label(text) { return <b>{text}</b>; }
      export function App() { return <Label text="a" />; }
    `)).not.toThrow();
  });
});
