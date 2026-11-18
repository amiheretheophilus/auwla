/** One stored program must retain each destination's namespace and lifetime. */
import { expect } from 'bun:test';
import { behaves } from '../../../tests/harness/run';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

behaves('stored templates update and remount independently in HTML and SVG', {
  source: `
    export function App() {
      let value = 0;
      let shown = true;
      const view = <custom-shape data-root title={value}>
        <foreignObject><section data-content>{value}</section></foreignObject>
        <svg><text data-explicit>{value}</text></svg>
      </custom-shape>;
      return <main><section data-html>{shown && view}</section>
        <svg data-svg>{shown && view}</svg>
        <button id="inc" onClick={() => value++}>inc</button>
        <button id="toggle" onClick={() => shown = !shown}>toggle</button></main>;
    }
  `,
  steps: [{ click: '#inc' }, { click: '#toggle' }, { click: '#toggle' }, { click: '#inc' }],
  check(container, observation) {
    const roots = [...container.querySelectorAll('[data-root]')];

    if (observation === 2) {
      expect(roots).toHaveLength(0);
      return;
    }

    const value = ['0', '1', '', '1', '2'][observation]!;

    expect(roots.map((root) => root.namespaceURI)).toEqual([HTML, SVG]);
    expect(roots.map((root) => root.getAttribute('title'))).toEqual([value, value]);
    expect(roots.map((root) => root.firstElementChild?.namespaceURI)).toEqual([HTML, SVG]);
    expect(roots.map((root) => root.querySelector('[data-content]')?.namespaceURI)).toEqual([HTML, HTML]);
    expect(roots.map((root) => root.querySelector('[data-content]')?.textContent)).toEqual([value, value]);
    expect(roots.map((root) => root.querySelector('[data-explicit]')?.namespaceURI)).toEqual([SVG, SVG]);
    expect(roots.map((root) => root.querySelector('[data-explicit]')?.textContent)).toEqual([value, value]);
  },
});

behaves('stored fragments keep text roots and foreignObject namespace boundaries', {
  source: `
    export function App() {
      let value = 0;
      const view = <>before{value}<foreignObject><b data-content>{value}</b></foreignObject>after</>;
      return <main><section data-html>{view}</section><svg data-svg>{view}</svg>
        <button onClick={() => value++}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    const html = container.querySelector('[data-html]')!;
    const svg = container.querySelector('[data-svg]')!;
    const text = `before${observation}${observation}after`;

    expect(html.textContent).toBe(text);
    expect(svg.textContent).toBe(text);
    expect(html.firstElementChild?.namespaceURI).toBe(HTML);
    expect(svg.firstElementChild?.namespaceURI).toBe(SVG);
    expect(html.querySelector('[data-content]')?.namespaceURI).toBe(HTML);
    expect(svg.querySelector('[data-content]')?.namespaceURI).toBe(HTML);
  },
});
