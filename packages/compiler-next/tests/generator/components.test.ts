/** Combine component identity, props, keyed moves and independent local state. */
import { expect, it } from 'bun:test';
import fc from 'fast-check';
import type { Case } from '../harness/case';
import { disposeRuns, observeBoth } from '../harness/run';

const configuration = fc.record({
  form: fc.constantFrom('named', 'member', 'factory'),
  first: fc.integer({ min: -5, max: 5 }),
  second: fc.integer({ min: -5, max: 5 }),
  spread: fc.boolean(),
});

interface Configuration {
  form: string;
  first: number;
  second: number;
  spread: boolean;
}

function componentCase(config: Configuration): Case {
  const body = `({ id, start, label }) {
    let count = start;
    return <li data-id={id}><span>{label}:{count}</span>
      <button id={'edit-' + id} onClick={() => count++}>edit</button></li>;
  }`;
  let declaration: string;
  let tag: string;
  if (config.form === 'member') {
    declaration = `const UI = { Row: ${body.replace(') {', ') => {')} };`;
    tag = 'UI.Row';
  } else if (config.form === 'factory') {
    declaration = `function make() { return function Row${body}; } const View = make();`;
    tag = 'View';
  } else {
    declaration = `function Row${body}`;
    tag = 'Row';
  }
  const props = config.spread ? '{...row} label={label}' : 'id={row.id} start={row.start} label={label}';
  return {
    source: `
      ${declaration}
      export function App() {
        let label = 'A';
        const rows = [{ id: 'a', start: ${config.first} }, { id: 'b', start: ${config.second} }];
        return <main><ul>{rows.map(row => <${tag} key={row.id} ${props} />)}</ul>
          <button id="reverse" onClick={() => rows.reverse()}>reverse</button>
          <button id="label" onClick={() => { label = 'B'; }}>label</button>
          <button id="remove" onClick={() => rows.shift()}>remove</button></main>;
      }`,
    steps: [
      { click: '#edit-a' },
      { click: '#reverse' },
      { click: '#label' },
      { click: '#remove' },
      { click: '#edit-a' },
    ],
    check(container, observation) {
      const first = `A:${config.first}`;
      const edited = `A:${config.first + 1}`;
      const second = `A:${config.second}`;
      const expected = [
        [first, second],
        [edited, second],
        [second, edited],
        [`B:${config.second}`, `B:${config.first + 1}`],
        [`B:${config.first + 1}`],
        [`B:${config.first + 2}`],
      ];
      expect([...container.querySelectorAll('li span')].map((node) => node.textContent))
        .toEqual(expected[observation]!);
      const row = container.querySelector('[data-id="a"]')!;
      if (observation === 1) {
        row.setAttribute('data-retained', 'yes');
      }
      if (observation > 1) {
        expect(row.getAttribute('data-retained')).toBe('yes');
      }
    },
  };
}

it('generated component combinations agree with native observations and the reference', async () => {
  let sequence = 0;
  await fc.assert(fc.asyncProperty(configuration, async (config) => {
    disposeRuns();
    const testCase = componentCase(config);
    const result = await observeBoth(`generated-components-${sequence++}`, testCase);
    expect(result.compiled).toEqual(result.reference);
  }), {
    numRuns: Number(process.env.FC_RUNS ?? 20),
    seed: process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED),
    verbose: true,
  });
}, 120_000);
