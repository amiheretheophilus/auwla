/**
 * Slot lowering on its own (`lower.ts`): the props it gives a component, and the mistakes it
 * reports. Behaviour is compared with the reference in `tests/cases/components.slots.test.ts`.
 */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';
import { lowerSlots } from './lower';

const lower = (source: string) => lowerSlots('./App.tsx', source).replace(/\s+/g, ' ').trim();
const compile = (source: string) => compileModules({ './App.tsx': source }, {});

describe('the props a slot component reads its content from', () => {
  it('gives a component without props a pattern', () => {
    expect(lower('function Panel() { return <div><slot /></div>; }'))
      .toBe('function Panel({ children: $slot_default }) { return <div>{$slot_default}</div>; }');
  });

  it('adds to an existing pattern, before its rest', () => {
    expect(lower('function Card({ title, ...rest }) { return <div {...rest}><slot name="side" /></div>; }'))
      .toBe('function Card({ title, "slot:side": $slot_side, ...rest }) { return <div {...rest}>{$slot_side}</div>; }');
  });

  it('reuses a children binding the pattern already has', () => {
    expect(lower('function Box({ children: content }) { return <p><slot />{content}</p>; }'))
      .toBe('function Box({ children: content }) { return <p>{content}{content}</p>; }');
  });

  it('reads through a props name', () => {
    expect(lower('const Panel = (props) => <div><slot name="top">none</slot></div>;'))
      .toBe('const Panel = (props) => <div>{props["slot:top"] !== void 0 ? props["slot:top"] : <>none</>}</div>;');
  });

  it('moves marked children to slot props and removes the marker', () => {
    expect(lower('function App() { return <Panel><b slot="top">T</b><p>body</p></Panel>; }'))
      .toBe('function App() { return <Panel slot:top={<b>T</b>}><p>body</p></Panel>; }');
  });
});

describe('slot mistakes are compile errors', () => {
  it.each([
    ['a dynamic slot name', 'function Panel() { return <div><slot name={which} /></div>; }', /static name/],
    ['an empty slot name', 'function Panel() { return <div><slot name="" /></div>; }', /static name/],
    ['a dynamic marker', 'function App() { return <Panel><b slot={which}>x</b></Panel>; }', /static name/],
    ['a marker inside a wrapper', 'function App() { return <Panel><div><b slot="top">x</b></div></Panel>; }', /direct child/],
    ['a marker outside any call', 'function App() { return <div><b slot="top">x</b></div>; }', /direct child/],
    ['elements targeting different slots', 'function App(){ let c; return <Panel>{c ? <b slot="a"/> : <i slot="b"/>}</Panel>; }', /same slot/],
    ['marked and unmarked elements together', 'function App(){ let c; return <Panel>{c ? <b slot="a"/> : <i/>}</Panel>; }', /same slot/],
    ['a slot outside a component', 'const view = <div><slot /></div>;', /inside a component/],
    ['an array pattern for props', 'function Panel([first]) { return <div><slot /></div>; }', /name or an object pattern/],
  ])('%s', (_name, source, message) => {
    expect(() => compile(source)).toThrow(message);
  });

  it('content for a slot a component of the module does not show', () => {
    expect(() => compile(`
      function Panel() { return <section><slot name="title" /></section>; }
      export function App() { return <Panel><b slot="titel">x</b></Panel>; }`)).toThrow(/Panel has no slot 'titel'/);
  });

  it('not when the component can pass its props on', () => {
    for (const params of ['props', '{ tone, ...rest }']) {
      expect(() => compile(`
        function Inner() { return <i><slot name="extra" /></i>; }
        function Panel(${params}) { return <section><slot name="title" /></section>; }
        export function App() { return <Panel><b slot="extra">x</b></Panel>; }`)).not.toThrow();
    }
  });
});
