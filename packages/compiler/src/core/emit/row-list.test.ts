/** Namespace sharing must retain row keys, edits and foreignObject boundaries. */
import { expect } from 'bun:test';
import { behaves } from '../../../tests/harness/run';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

behaves('compiled custom rows share namespace-aware creation through edits and reordering', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
      return <main>
        <section data-html>{rows.map(row => <custom-shape key={row.id} data-id={row.id}>
          <foreignObject><b>{row.label}</b></foreignObject><svg><text>{row.label}</text></svg>
        </custom-shape>)}</section>
        <svg data-svg>{rows.map(row => <custom-shape key={row.id} data-id={row.id}>
          <foreignObject><b>{row.label}</b></foreignObject><svg><text>{row.label}</text></svg>
        </custom-shape>)}</svg>
        <button id="edit" onClick={() => rows[0].label += '!'}>edit</button>
        <button id="reverse" onClick={() => rows.reverse()}>reverse</button>
        <button id="clear" onClick={() => rows = []}>clear</button>
      </main>;
    }
  `,
  steps: [{ click: '#edit' }, { click: '#reverse' }, { click: '#edit' }, { click: '#clear' }],
  check(container, observation) {
    const html = [...container.querySelectorAll('[data-html] > custom-shape')];
    const svg = [...container.querySelectorAll('[data-svg] > custom-shape')];
    const labels = [['one', 'two'], ['one!', 'two'], ['two', 'one!'], ['two!', 'one!'], []][observation]!;
    const keys = [['1', '2'], ['1', '2'], ['2', '1'], ['2', '1'], []][observation]!;

    expect(html.map((row) => row.getAttribute('data-id'))).toEqual(keys);
    expect(svg.map((row) => row.getAttribute('data-id'))).toEqual(keys);
    expect(html.map((row) => row.namespaceURI)).toEqual(labels.map(() => HTML));
    expect(svg.map((row) => row.namespaceURI)).toEqual(labels.map(() => SVG));

    for (const row of [...html, ...svg]) {
      expect(row.querySelector('b')?.namespaceURI).toBe(HTML);
      expect(row.querySelector('text')?.namespaceURI).toBe(SVG);
    }

    expect(html.map((row) => row.querySelector('b')?.textContent)).toEqual(labels);
    expect(svg.map((row) => row.querySelector('b')?.textContent)).toEqual(labels);
    expect(html.map((row) => row.querySelector('text')?.textContent)).toEqual(labels);
    expect(svg.map((row) => row.querySelector('text')?.textContent)).toEqual(labels);
  },
});
