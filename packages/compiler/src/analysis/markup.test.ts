import { expect, it } from 'bun:test';
import { inspectMarkup } from './index';

it('distinguishes component boundaries from inline callbacks without claiming component props', () => {
  const source = `export function App() {
    function Child() { return <b />; }
    return <main>{[1].map(value => <i>{value}</i>)}<Child /></main>;
  }`;
  const result = inspectMarkup(source);
  expect(result.functions.map((fn) => fn.component)).toEqual([true, true, false]);
  expect(result.elements.map((element) => source.slice(element.range[0], element.attributesAt)))
    .toEqual(['<b ', '<main', '<i']);
  expect(result.elements.map((element) => element.functions)).toEqual([[1, 0], [0], [2, 0]]);
});

it('reports insertion positions in input TSX after lowering types, enums and slots', () => {
  const source = `enum Size { Small = 1 }
  export const Card = (props: { label: string }) => <svg><path /><slot><text>{props.label}</text></slot></svg>;`;
  const result = inspectMarkup(source);
  expect(result.functions.some((fn) => source.slice(fn.range[0]).startsWith('(props:'))).toBe(true);
  expect(result.elements.map((element) => source.slice(element.range[0], element.attributesAt)))
    .toEqual(['<svg', '<path ', '<text']);
  expect(result.elements.every((element) => /^\/?\>/.test(source.slice(element.attributesAt)))).toBe(true);
});
