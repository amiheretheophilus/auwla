/** Phase 3 template slice: visible output plus independent DOM assertions. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('static markup: nested elements and attribute aliases', {
  source: `export function App() {
    return <main className="page"><label htmlFor="name">Name</label><input id="name" disabled /><br /><hr /></main>;
  }`,
  check(container) {
    expect(container.querySelector('main')!.className).toBe('page');
    expect(container.querySelector('label')!.htmlFor).toBe('name');
    expect(container.querySelector('input')!.disabled).toBe(true);
    expect(container.querySelector('main')!.children.length).toBe(4);
  },
});

behaves('static markup: whitespace entities and escaped attributes', {
  source: `export const App = () => <p title='a &quot;quote&quot; &amp; &lt;tag&gt;'>
    Hello
    <strong>wide &amp; bright</strong>
    world &lt;3
  </p>;`,
  check(container) {
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('Hellowide & brightworld <3');
    expect(p.title).toBe('a "quote" & <tag>');
  },
});

behaves('static markup: fragment roots and nested fragments', {
  source: `export function App() { return <>start<><b>bold</b>middle</><i>end</i></>; }`,
  check(container) {
    expect(container.textContent).toBe('startboldmiddleend');
    expect(container.children.length).toBe(2);
  },
});

behaves('static markup: empty fragment', {
  source: `export const App = () => <></>;`,
  check(container) {
    expect(container.childNodes.length).toBe(0);
  },
});

behaves('static markup: adjacent primitive expressions', {
  source: `export function App() {
    const word = 'text';
    return <p>{1}{2}{word}{false}{null}{undefined}{true}{0}</p>;
  }`,
  check(container) {
    expect(container.textContent).toBe('12text0');
  },
});

behaves('static markup: expression-only fragment root', {
  source: `export const App = () => <>{'hello'}</>;`,
  check(container) {
    expect(container.textContent).toBe('hello');
    expect(container.firstChild!.nodeType).toBe(Node.TEXT_NODE);
  },
});

behaves('static markup: initial DOM properties', {
  source: `export function App() {
    return <main><input value="initial" /><input type="checkbox" checked={true} />
      <select><option value="a">A</option><option value="b" selected>B</option></select></main>;
  }`,
  check(container) {
    expect(container.querySelector('input')!.value).toBe('initial');
    expect(container.querySelector<HTMLInputElement>('[type=checkbox]')!.checked).toBe(true);
    expect(container.querySelector('select')!.value).toBe('b');
  },
});

behaves('static markup: table tree without parser-inserted tbody', {
  source: `export const App = () => <table><tr><td>cell</td></tr></table>;`,
  check(container) {
    expect(container.querySelector('table')!.firstElementChild!.tagName).toBe('TR');
    expect(container.querySelector('tbody')).toBeNull();
    expect(container.textContent).toBe('cell');
  },
});

behaves('static markup: paragraph nesting stays as authored', {
  source: `export const App = () => <p><span><div>inside</div></span>after</p>;`,
  check(container) {
    expect(container.querySelector('p > span > div')!.textContent).toBe('inside');
    expect(container.children.length).toBe(1);
    expect(container.textContent).toBe('insideafter');
  },
});

behaves('static markup: nested buttons stay nested', {
  source: `export const App = () => <button>outer<button>inner</button></button>;`,
  check(container) {
    expect(container.querySelector('button > button')!.textContent).toBe('inner');
    expect(container.children.length).toBe(1);
  },
});

behaves('static markup: SVG and foreignObject namespaces', {
  source: `export const App = () => <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" />
    <foreignObject><div>HTML</div></foreignObject></svg>;`,
  check(container) {
    expect(container.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(container.querySelector('foreignObject')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(container.querySelector('div')!.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 10 10');
  },
});

behaves('static markup: raw text is text rather than parsed markup', {
  source: `export const App = () => <main><textarea>{'<b>plain & text</b>'}</textarea>
    <style>{'.a > .b { color: red; }'}</style></main>;`,
  check(container) {
    expect(container.querySelector('textarea')!.textContent).toBe('<b>plain & text</b>');
    expect(container.querySelector('textarea b')).toBeNull();
    expect(container.querySelector('style')!.textContent).toBe('.a > .b { color: red; }');
  },
});

behaves('static markup: generated names do not shadow authored bindings', {
  source: `const _MD = 'module';
    export function App() {
      const _document = 'document', _nodes = 'nodes', _p = 'p', _text = 'text';
      return <p>{_MD}{_document}{_nodes}{_p}{_text}</p>;
    }`,
  check(container) {
    expect(container.textContent).toBe('moduledocumentnodesptext');
  },
});

behaves('static markup: attribute and child expressions run in authored order', {
  source: `export function App() {
    const calls = new Set();
    const record = value => { calls.add(value); return value; };
    return <main data-first={record('parent')}><p title={record('child')}>{record('text')}</p>
      <output>{Array.from(calls).join(',')}</output></main>;
  }`,
  check(container) {
    expect(container.querySelector('main')!.getAttribute('data-first')).toBe('parent');
    expect(container.querySelector('p')!.title).toBe('child');
    expect(container.querySelector('output')!.textContent).toBe('parent,child,text');
  },
});

behaves('static markup: setup and native event callback run once', {
  source: `export function App() {
    const label = 'once';
    return <button onClick={event => { event.currentTarget.textContent += '!'; }}>{label}</button>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('button')!.textContent).toBe('once' + '!'.repeat(observation));
  },
});

behaves('static markup: repeated attributes keep the last value', {
  source: `export function App() {
    const first = 'first';
    return <div id={first} id="last" title="before" title={first} data-omit="present" data-omit={false} />;
  }`,
  check(container) {
    const div = container.querySelector('div')!;
    expect(div.id).toBe('last');
    expect(div.title).toBe('first');
    expect(div.hasAttribute('data-omit')).toBe(false);
  },
});

behaves('static markup: nested markup in expression containers', {
  source: `export const App = () => (<main>{(<p>inside</p> as any)}{<>tail<b>end</b></>}</main> as any);`,
  check(container) {
    expect(container.querySelector('main > p')!.textContent).toBe('inside');
    expect(container.querySelector('main > b')!.textContent).toBe('end');
    expect(container.textContent).toBe('insidetailend');
  },
});

behaves('static markup: attribute conversion does not use an authored String binding', {
  source: `export function App() {
    const String = () => 'wrong';
    const label = 42;
    return <div data-label={label} />;
  }`,
  check(container) {
    expect(container.querySelector('div')!.getAttribute('data-label')).toBe('42');
  },
});
