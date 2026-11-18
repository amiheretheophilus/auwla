import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { setAttributeValue } from '../src/setters';

const document = new Window().document as unknown as Document;

for (const namespace of ['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg']) {
  it(`keeps ARIA booleans as text in ${namespace} attribute sites`, () => {
    const element = document.createElementNS(namespace, 'button');
    for (const [value, expected] of [
      [false, 'false'], [true, 'true'], [undefined, null], [false, 'false'], [null, null],
    ] as const) {
      setAttributeValue(element, 'aria-pressed', value);
      expect(element.getAttribute('aria-pressed')).toBe(expected);
    }
  });
}

it('retains HTML presence booleans and textual true for other attributes', () => {
  const element = document.createElement('input');
  setAttributeValue(element, 'disabled', true);
  expect(element.getAttribute('disabled')).toBe('');
  setAttributeValue(element, 'disabled', false);
  expect(element.hasAttribute('disabled')).toBe(false);
  setAttributeValue(element, 'data-ready', true);
  expect(element.getAttribute('data-ready')).toBe('true');
  setAttributeValue(element, 'data-ready', false);
  expect(element.hasAttribute('data-ready')).toBe(false);
});
