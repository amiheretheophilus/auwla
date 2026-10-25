/** Vary component identity, prop semantics, keyed state and destination namespace. */
import { expect, it } from 'bun:test';
import fc from 'fast-check';
import type { Case } from '../harness/case';
import { disposeRuns, observeBoth } from '../harness/run';

const configuration = fc.record({
  form: fc.constantFrom('named', 'member', 'factory'),
  first: fc.integer({ min: -5, max: 5 }),
  second: fc.integer({ min: -5, max: 5 }),
  spread: fc.boolean(),
  symbolLabel: fc.boolean(),
});

interface Configuration {
  form: string;
  first: number;
  second: number;
  spread: boolean;
  symbolLabel: boolean;
}

function componentCase(config: Configuration): Case {
  const body = `({ id, start, [labelKey]: label, ...rest }) {
    let count = start;
    return <li data-id={id}>
      <span>{label}:{count}</span>
      <code>{Object.keys(rest).join(',')}</code>
      <button id={'edit-' + id} onClick={() => count++}>edit</button>
    </li>;
  }`;
  let declaration: string;
  let tag: string;
  if (config.form === 'member') {
    declaration = `const UI = { Row: ${body.replace(') {', ') => {')} };`;
    tag = 'UI.Row';
  } else if (config.form === 'factory') {
    declaration = `function make() {
      return function Row${body};
    }
    const View = make();`;
    tag = 'View';
  } else {
    declaration = `function Row${body}`;
    tag = 'Row';
  }
  const props = config.spread ? '{...row}' : 'id={row.id} start={row.start}';
  return {
    source: `
      const labelKey = ${config.symbolLabel ? "Symbol('label')" : "'label'"};
      ${declaration}
      export function App() {
        let label = 'A';
        let reversed = false;
        const rows = [{ id: 'a', start: ${config.first} }, { id: 'b', start: ${config.second} }];
        const labels = { [labelKey]: label };
        const extra = reversed ? { b: 2, a: 1 } : { a: 1, b: 2 };
        return <main><ul>{rows.map(row => <${tag} key={row.id} ${props} {...labels} {...extra} />)}</ul>
          <button id="reverse" onClick={() => rows.reverse()}>reverse</button>
          <button id="label" onClick={() => { label = 'B'; }}>label</button>
          <button id="order" onClick={() => { reversed = true; }}>order</button>
          <button id="remove" onClick={() => rows.shift()}>remove</button></main>;
      }`,
    steps: [
      { click: '#edit-a' },
      { click: '#reverse' },
      { click: '#label' },
      { click: '#order' },
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
        [`B:${config.second}`, `B:${config.first + 1}`],
        [`B:${config.first + 1}`],
        [`B:${config.first + 2}`],
      ];
      expect([...container.querySelectorAll('li span')].map((node) => node.textContent))
        .toEqual(expected[observation]!);
      const order = observation < 4 ? 'a,b' : 'b,a';
      for (const rest of container.querySelectorAll('li code')) {
        expect(rest.textContent).toBe(order);
      }
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

const customTag = fc.array(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z'), {
  minLength: 1,
  maxLength: 8,
}).map((letters) => `probe-${letters.join('')}`);

const namespaceConfiguration = fc.record({
  tag: fc.oneof(fc.constantFrom('a', 'circle', 'div'), customTag),
  form: fc.constantFrom('component', 'stored', 'helper', 'dynamic'),
  initial: fc.integer({ min: -10, max: 10 }),
});

it('generated markup takes each consuming namespace without changing its values', async () => {
  let sequence = 0;
  await fc.assert(fc.asyncProperty(namespaceConfiguration, async ({ tag, form, initial }) => {
    disposeRuns();
    // The tag's spelling cannot decide its namespace. Consume the same authored
    // value twice and assert native namespaceURI independently of the oracle.
    const markup = `<${tag} data-probe={value}>{value}</${tag}>`;
    let declaration = '';
    let setup = '';
    let view: string;
    if (form === 'component') {
      declaration = `function Probe({ value }) {
        return ${markup};
      }`;
      view = '<Probe value={value} />';
    } else if (form === 'dynamic') {
      setup = `const Tag = '${tag}';`;
      view = '<Tag data-probe={value}>{value}</Tag>';
    } else {
      if (form === 'helper') {
        declaration = `function draw(value) {
          return ${markup};
        }`;
      }
      setup = `const view = ${form === 'helper' ? 'draw(value)' : markup};`;
      view = '{view}';
    }
    const testCase: Case = {
      source: `${declaration}
        export function App() {
          let value = ${initial};
          ${setup}
          return <main>
            <section>${view}</section>
            <svg>${view}</svg>
            <button id="inc" onClick={() => value++}>inc</button>
          </main>;
        }`,
      steps: [{ click: '#inc' }, { click: '#inc' }],
      check(container, observation) {
        const nodes = [...container.querySelectorAll('[data-probe]')];
        expect(nodes.map((node) => node.namespaceURI)).toEqual([
          'http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg',
        ]);
        for (const node of nodes) {
          expect(node.getAttribute('data-probe')).toBe(String(initial + observation));
          expect(node.textContent).toBe(String(initial + observation));
        }
      },
    };
    const result = await observeBoth(`generated-namespaces-${sequence++}`, testCase);
    expect(result.compiled).toEqual(result.reference);
  }), {
    numRuns: Number(process.env.FC_RUNS ?? 20),
    seed: process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED),
    verbose: true,
  });
}, 120_000);
