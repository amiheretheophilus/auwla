/**
 * Cases for wiki/compiler/conditionals-and-lists.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('list: sparse arrays skip holes and retain keyed children through updates', {
  source: `
    export function App() {
      let value = 1;
      const children = [<li key="a">A:{value}</li>, , <li key="b">B:{value}</li>];
      return <main><ul>{children}</ul>
        <button onClick={() => value++}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(root, observation) {
    expect(root.querySelector('ul')?.textContent).toBe(['A:1B:1', 'A:2B:2'][observation]!);
    const first = root.querySelector('li')!;
    if (observation === 0) {
      first.setAttribute('data-retained', 'yes');
    } else {
      expect(first.getAttribute('data-retained')).toBe('yes');
    }
  },
});

behaves('list: rendering an array does not invoke its overridden map method', {
  source: `
    export function App() {
      const children = [<li key="a">A</li>, <li key="b">B</li>];
      children.map = () => { throw new Error('unrelated method'); };
      return <ul>{children}</ul>;
    }
  `,
  check(root) {
    expect(root.textContent).toBe('AB');
  },
});

behaves('conditional: stored JSX preserves creation-time values and follows later changes', {
  source: `export function App() {
    let count = 1;
    const view = <b>{count}</b>;
    count = 2;
    return <main>{view}<button onClick={() => count++}>inc</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check(root, index) { expect(root.querySelector('b')!.textContent).toBe(['1', '3'][index]!); },
});

behaves('conditional: an early return preserves state across returning branches', {
  source: `export function App() {
    let show = false, count = 1;
    if (!show) return <button id="open" onClick={() => show = true}>open</button>;
    return <main><p>{count}</p><button id="inc" onClick={() => count++}>inc</button>
      <button id="close" onClick={() => show = false}>close</button></main>;
  }`,
  steps: [{ click: '#open' }, { click: '#inc' }, { click: '#close' }, { click: '#open' }],
  check(root, index) { expect(root.querySelector('p')?.textContent ?? 'open').toBe(['open', '1', '2', 'open', '2'][index]!); },
});

behaves('conditional: setup after an early return runs once, when first reached', {
  source: `export function App() {
    let show = false;
    const log = [];
    if (!show) return <button id="open" onClick={() => show = true}>open</button>;
    let count = 0;
    log.push('setup');
    return <main><p>{count} {log.length}</p><button id="inc" onClick={() => count++}>inc</button>
      <button id="close" onClick={() => show = false}>close</button></main>;
  }`,
  steps: [{ click: '#open' }, { click: '#inc' }, { click: '#close' }, { click: '#open' }],
  check(root, index) {
    expect(root.querySelector('p')?.textContent ?? 'open').toBe(['open', '0 1', '1 1', 'open', '1 1'][index]!);
  },
});

behaves('conditional: a derived value after an early return follows its input once reached', {
  source: `export function App() {
    let n = 1, show = false;
    if (!show) return <button id="show" onClick={() => show = true}>show</button>;
    const doubled = n * 2;
    return <p id="out" onClick={() => n++}>{doubled}</p>;
  }`,
  steps: [{ click: '#show' }, { click: '#out' }, { click: '#out' }],
  check(root, index) {
    expect(root.textContent).toBe(['show', '2', '4', '6'][index]!);
  },
});

behaves('conditional: setup between two early returns', {
  source: `export function App() {
    let step = 0;
    if (step === 0) return <button id="next" onClick={() => step++}>start</button>;
    let label = 'middle ' + step;
    if (step === 1) return <button id="next" onClick={() => step++}>{label}</button>;
    return <p id="done" onClick={() => step = 0}>done, {label}</p>;
  }`,
  steps: [{ click: '#next' }, { click: '#next' }, { click: '#done' }, { click: '#next' }],
  check(root, index) {
    expect(root.textContent).toBe(['start', 'middle 1', 'done, middle 2', 'start', 'middle 1'][index]!);
  },
});

behaves('conditional: a switch returns one branch per case', {
  source: `export function App() {
    let tab = 'a';
    switch (tab) {
      case 'a': return <p id="a" onClick={() => tab = 'b'}>A</p>;
      case 'b': return <p id="b" onClick={() => tab = 'c'}>B</p>;
      default: return <p id="c" onClick={() => tab = 'a'}>C</p>;
    }
  }`,
  steps: [{ click: 'p' }, { click: 'p' }, { click: 'p' }],
  check(root, index) {
    expect(root.textContent).toBe(['A', 'B', 'C', 'A'][index]!);
  },
});

behaves('conditional: a returned value reads a block-local declaration', {
  source: `export function App() {
    let n = 1;
    switch (n % 2) {
      case 0: {
        const label = 'even ' + n;
        return <p onClick={() => n++}>{label}</p>;
      }
      default: {
        const label = 'odd ' + n;
        return <p onClick={() => n++}>{label}</p>;
      }
    }
  }`,
  steps: [{ click: 'p' }, { click: 'p' }],
  check(root, index) {
    expect(root.textContent).toBe(['odd 1', 'even 2', 'odd 3'][index]!);
  },
});

behaves('conditional: a loop returns from inside its body', {
  source: `export function App() {
    let items = [{ name: 'a', bad: false }];
    for (const item of items) {
      if (item.bad) return <p id="bad" onClick={() => items = items.slice(0, 1)}>bad {item.name}</p>;
    }
    return <button onClick={() => items = [...items, { name: 'b', bad: true }]}>{items.length}</button>;
  }`,
  steps: [{ click: 'button' }, { click: '#bad' }],
  check(root, index) {
    expect(root.textContent).toBe(['1', 'bad b', '1'][index]!);
  },
});

behaves('conditional: selected branch retains its nodes while text updates', {
  source: `export function App() {
    let show = true, count = 1;
    return <main>{show ? <b>{count}</b> : <i>off</i>}
      <button id="inc" onClick={() => count++}>inc</button>
      <button id="toggle" onClick={() => show = !show}>toggle</button></main>;
  }`,
  steps: [{ click: '#inc' }, { click: '#toggle' }, { click: '#toggle' }],
  check(root, index) {
    expect(root.querySelector('b, i')!.textContent).toBe(['1', '2', 'off', '2'][index]!);
  },
});

behaves('conditional: logical markup preserves zero and updates a retained branch', {
  source: `export function App() {
    let count = 0;
    return <main><p>{count && <b>{count}</b>}</p><button onClick={() => count++}>inc</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(root, index) { expect(root.querySelector('p')!.textContent).toBe(String(index)); },
});

behaves('conditional: nested fragment regions preserve authored order', {
  source: `export function App() {
    let a = true, b = false;
    return <main>start{a ? <><p>{b ? <b>yes</b> : <i>no</i>}</p><span>end</span></> : 'off'}
      <button id="a" onClick={() => a = !a}>a</button><button id="b" onClick={() => b = !b}>b</button></main>;
  }`,
  steps: [{ click: '#b' }, { click: '#a' }, { click: '#a' }],
  check(root, index) { expect(root.textContent).toBe(['startnoendab', 'startyesendab', 'startoffab', 'startyesendab'][index]!); },
});

behaves('conditional: nullish and or markup use different fallback tests', {
  source: `export function App() {
    let value = null;
    return <main><p>{value ?? <b>none</b>}:{value || <i>empty</i>}</p>
      <button onClick={() => value = 0}>set</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check(root, index) { expect(root.querySelector('p')!.textContent).toBe(['none:empty', '0:empty'][index]!); },
});

behaves('a list from a call result', {
  source: `
    let items = [1, 2];
    function load() { return items; }
    export function App() {
      return <main><ul>{load().map((n) => <li key={n}>{n}</li>)}</ul><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a list callback that uses the whole array', {
  source: `
    export function App() {
      let items = ['a', 'b'];
      return (
        <main>
          <ul>{items.map((item, index, all) => <li key={item}>{item} {index + 1}/{all.length}</li>)}</ul>
          <button onClick={() => items.push('c')}>add</button>
        </main>
      );
    }`,
  steps: [{ click: 'button' }],
});

behaves('JSX pushed into an array in a loop', {
  source: `
    export function App() {
      let items = [1, 2];
      const rows = [];
      for (const n of items) rows.push(<li key={n}>{n}</li>);
      return <main><ul>{rows}</ul><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a key outside a list', {
  source: `
    export function App() {
      return <p key="x">hello</p>;
    }`,
});

behaves('a dynamic key outside a list remounts', {
  source: `
    function Field() {
      let draft = 'start';
      return <input value={draft} onInput={(event) => (draft = event.target.value)} />;
    }
    export function App() {
      let id = 1;
      return <main><Field key={id} /><button onClick={() => id++}>next</button></main>;
    }`,
  steps: [{ input: 'input', value: 'typed' }, { click: 'button' }],
});

behaves('a map over a module constant', {
  source: `
    const ITEMS = [1, 2];
    export function App() {
      return <main><ul>{ITEMS.map((n) => <li key={n}>{n}</li>)}</ul><button onClick={() => ITEMS.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('filter then map', {
  source: `
    export function App() {
      let items = [1, 2, 3, 4];
      return (
        <main>
          <ul>{items.filter((n) => n % 2 === 0).map((n) => <li key={n}>{n}</li>)}</ul>
          <button onClick={() => items.push(6)}>add</button>
        </main>
      );
    }`,
  steps: [{ click: 'button' }],
});

behaves('a switch on state in the body', {
  source: `
    export function App() {
      let mode = 'a';
      let view;
      switch (mode) {
        case 'a': view = <p>first</p>; break;
        default: view = <p>other</p>;
      }
      return <main>{view}<button onClick={() => (mode = 'b')}>switch</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('nullish coalescing in JSX', {
  source: `
    export function App() {
      let name = null;
      return <main><p>{name ?? 'nobody'}</p><button onClick={() => (name = 'Ada')}>set</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an early return', {
  source: `
    export function App() {
      let items = [];
      if (items.length === 0) return <button onClick={() => items.push(1)}>empty</button>;
      return <ul>{items.map((n) => <li key={n}>{n}</li>)}</ul>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an inline array list follows its state input', {
  source: `
    export function App() {
      let a = 1;
      return <main><ul>{[a].map(n => <li key={n}>{n}</li>)}</ul>
        <button onClick={() => a++}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('ul')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('a map callback passed by function reference', {
  source: `
    function Row(item) { return <li>{item}</li>; }
    export function App() {
      let items = [1];
      return <main><ul>{items.map(Row)}</ul><button onClick={() => items.push(2)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('ul')?.textContent).toBe(['1', '12'][observation]);
  },
});

behaves('a literal key on interactive markup keeps state', {
  source: `
    export function App() {
      let n = 0;
      return <main key="root"><p key={'out'}>{n}</p>
        <button key="button" onClick={() => n++}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['0', '1'][observation]);
  },
});

behaves('a keyed component keeps state on unrelated updates and resets on each new key', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <section><p id="count">{label}:{count}</p>
        <button id={'inc-' + label} onClick={() => count++}>inc</button></section>;
    }
    export function App() {
      let user = 'a';
      let other = 0;
      return <main><p id="other-value">{other}</p><Counter key={user} label={user} />
        <button id="switch" onClick={() => { user = user === 'a' ? 'b' : 'a'; }}>switch</button>
        <button id="other" onClick={() => other++}>other</button></main>;
    }`,
  steps: [{ click: '#inc-a' }, { click: '#inc-a' }, { click: '#other' }, { click: '#switch' }, { click: '#switch' }],
  check(container, observation) {
    expect(container.querySelector('#count')?.textContent).toBe(['a:0', 'a:1', 'a:2', 'a:2', 'b:0', 'a:0'][observation]);
  },
});

const previousPanels = new WeakMap<HTMLElement, globalThis.Element>();
behaves('a changed host key replaces the DOM node', {
  source: `
    export function App() {
      let version = 1;
      return <main><section id="panel" key={version}>v{version}</section>
        <button onClick={() => version++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    const panel = container.querySelector('#panel')!;
    expect(panel.textContent).toBe(['v1', 'v2'][observation]!);
    if (observation > 0) expect(panel).not.toBe(previousPanels.get(container));
    previousPanels.set(container, panel);
  },
});

behaves('keys work at a component root and inside conditional branches', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <section><p id="count">{label}:{count}</p>
        <button id={'inc-' + label} onClick={() => count++}>inc</button></section>;
    }
    function Shell({ name }) {
      return <Counter key={name} label={name} />;
    }
    export function App() {
      let name = 'x';
      let on = true;
      return <main>{on ? <Shell key={name} name={name} /> : <p id="off">off</p>}
        <button id="rename" onClick={() => { name = name + 'x'; }}>rename</button>
        <button id="toggle" onClick={() => { on = !on; }}>toggle</button></main>;
    }`,
  steps: [{ click: '#inc-x' }, { click: '#rename' }, { click: '#toggle' }, { click: '#toggle' }],
  check(container, observation) {
    expect(container.querySelector('#count, #off')?.textContent).toBe(['x:0', 'x:1', 'xx:0', 'off', 'xx:0'][observation]);
  },
});

behaves('a key on a returned component root remounts without a keyed parent', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <section><p>{label}:{count}</p><button id="inc" onClick={() => count++}>inc</button></section>;
    }
    function Shell({ name }) {
      return <Counter key={name} label={name} />;
    }
    export function App() {
      let name = 'a';
      return <main><Shell name={name} />
        <button id="rename" onClick={() => { name = name + 'a'; }}>rename</button></main>;
    }`,
  steps: [{ click: '#inc' }, { click: '#rename' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['a:0', 'a:1', 'aa:0'][observation]);
  },
});

behaves('spread/rest: JSX spread children update and preserve keyed nodes', {
  source: `
    export function App() {
      const items = [1, 2]; const children = items.map(item => <b key={item}>{item}</b>);
      return <main><section>{...children}</section><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('section')?.textContent).toBe(['12', '123'][observation]);
    if (observation === 0) container.querySelector('b')!.setAttribute('data-retained', 'yes');
    if (observation === 1) expect(container.querySelector('b')?.getAttribute('data-retained')).toBe('yes');
  },
});

behaves('spread/rest: JSX spread primitive children retain order and update', {
  source: `
    export function App() {
      const items = [1, 2];
      return <main><p>{...items}</p><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['12', '123'][observation]); },
});

// --- Phase 4 audit (2026-10-24): early returns and regions under pressure ---

behaves('conditional: deferred setup writes state when first reached', {
  source: `export function App() {
    let ready = false, count = 0;
    if (!ready) return <button id="ready" onClick={() => ready = true}>ready</button>;
    count++;
    return <p id="p" onClick={() => count++}>{count}</p>;
  }`,
  steps: [{ click: '#ready' }, { click: '#p' }],
});

behaves('conditional: returns of null, text, a number, an array and markup', {
  source: `export function App() {
    let mode = 0;
    setInterval(() => { mode = (mode + 1) % 5; }, 100);
    if (mode === 0) return null;
    if (mode === 1) return 'text';
    if (mode === 2) return 42;
    if (mode === 3) return [<b key="a">a</b>, <i key="b">b</i>];
    return <main>markup</main>;
  }`,
  steps: [{ advance: 100 }, { advance: 100 }, { advance: 100 }, { advance: 100 }, { advance: 100 }],
});

behaves('conditional: return-only branches that cannot be one markup selection still update', {
  source: `export function App() {
    let mode = 0;
    const b = <button onClick={() => mode++}>n</button>;
    if (mode === 0) return ['zero', b];
    if (mode === 1) return [<b key="a">a</b>, b];
    return <main>{b}markup</main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});

behaves('conditional: text-only returns update', {
  source: `export function App() {
    let on = false;
    setInterval(() => { on = !on; }, 100);
    if (on) return 'on';
    return 'off';
  }`,
  steps: [{ advance: 100 }, { advance: 100 }],
});

behaves('conditional: a statement in a returning block runs again only when what it reads changes', {
  source: `export function App() {
    let n = 0, other = 0;
    const seen = [];
    if (n > 0) {
      seen.push(n);
      return <main><p>{seen.join(',')} {other}</p>
        <button id="other" onClick={() => other++}>other</button>
        <button id="n" onClick={() => n++}>n</button>
        <button id="zero" onClick={() => n = 0}>zero</button></main>;
    }
    return <button id="go" onClick={() => n++}>go</button>;
  }`,
  steps: [{ click: '#go' }, { click: '#other' }, { click: '#n' }, { click: '#other' }, { click: '#zero' }, { click: '#go' }],
  check(root, index) {
    const text = root.querySelector('p')?.textContent ?? 'go';
    expect(text).toBe(['go', '1 0', '1 1', '1,2 1', '1,2 2', 'go', '1,2,1 2'][index]!);
  },
});

behaves('conditional: a var in setup between returns is visible to the next return', {
  source: `export function App() {
    let n = 2;
    if (n > 5) return <p>big</p>;
    for (var i = 0, total = 0; i < n; i++) total += i;
    return <button onClick={() => n++}>{total} {i}</button>;
  }`,
  steps: [{ click: 'button' }],
});

behaves('conditional: a return inside try and a labeled block', {
  source: `export function App() {
    let n = 0;
    out: {
      if (n === 1) break out;
      try {
        if (n === 0) return <button onClick={() => n++}>zero</button>;
      } finally {
        n = n;
      }
    }
    return <button onClick={() => n++}>{n}</button>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});

behaves('conditional: a var in a returning block is visible to a later return, and undefined again on the next run', {
  source: `export function App() {
    let n = 0;
    if (n > 1) { var note = 'big'; return <p onClick={() => n = 0}>{note} {n}</p>; }
    for (var key in { a: 1 }) if (n === 1 && key === 'b') return null;
    return <button onClick={() => n++}>{n} {String(note)} {key}</button>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }, { click: 'p' }],
});

behaves('conditional: regions keep sibling order through many toggles', {
  source: `export function App() {
    let x = false, y = false;
    return <main><p>a{x && <b>X</b>}c{y ? <i>Y</i> : 'z'}d{x ? <><u>1</u><s>2</s></> : null}e</p>
      <button id="x" onClick={() => x = !x}>x</button><button id="y" onClick={() => y = !y}>y</button></main>;
  }`,
  steps: [{ click: '#x' }, { click: '#y' }, { click: '#x' }, { click: '#x' }, { click: '#y' }],
});

behaves('conditional: a nested conditional changes while its outer branch stays', {
  source: `export function App() {
    let outer = true, inner = 0;
    return <main>{outer ? <section>{inner % 2 === 0 ? <b>{inner}</b> : <i>{inner}</i>}</section> : <p>off</p>}
      <button id="i" onClick={() => inner++}>i</button><button id="o" onClick={() => outer = !outer}>o</button></main>;
  }`,
  steps: [{ click: '#i' }, { click: '#i' }, { click: '#o' }, { click: '#i' }, { click: '#o' }],
});

behaves('conditional: svg branches are created in the svg namespace', {
  source: `export function App() {
    let round = true;
    return <main><svg>{round ? <circle r="1" /> : <rect width="1" />}</svg>
      <button onClick={() => round = !round}>t</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check(root) {
    expect(root.querySelector('svg')!.firstElementChild!.namespaceURI).toBe('http://www.w3.org/2000/svg');
  },
});

behaves('conditional: falsy left operands of && show what JavaScript returns', {
  source: `export function App() {
    let i = 0;
    const values = [0, NaN, '', false, null, undefined, 1];
    const v = values[i];
    return <main><p>[{v && <b>yes</b>}]</p><button onClick={() => i = (i + 1) % values.length}>n</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }, { click: 'button' }, { click: 'button' }, { click: 'button' }, { click: 'button' }],
});

behaves('conditional: a stored JSX value consumed twice', {
  source: `export function App() {
    let n = 0;
    const view = <b onClick={() => n++}>{n}</b>;
    return <main>{view}<hr />{view}</main>;
  }`,
  steps: [{ click: 'b' }, { click: 'b' }],
});

behaves('conditional: a first return of a fragment, then a single element', {
  source: `export function App() {
    let many = true;
    if (many) return <><b>1</b><b>2</b><button onClick={() => many = false}>one</button></>;
    return <button onClick={() => many = true}>many</button>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});

behaves('conditional: a derived value between returns reads state written by the first branch', {
  source: `export function App() {
    let items = [];
    if (items.length === 0) return <button id="add" onClick={() => items = [...items, 'x']}>add</button>;
    const count = items.length;
    const label = count + ' item' + (count === 1 ? '' : 's');
    return <p id="more" onClick={() => items = [...items, 'y']}>{label}</p>;
  }`,
  steps: [{ click: '#add' }, { click: '#more' }, { click: '#more' }],
});

behaves('conditional: setup in a nested if without a return runs once between returns', {
  source: `export function App() {
    let step = 0;
    const log = [];
    if (step === 0) return <button id="b" onClick={() => step++}>start</button>;
    if (step > 0) { log.push('once'); }
    return <p id="b" onClick={() => step++}>{step} {log.length}</p>;
  }`,
  steps: [{ click: '#b' }, { click: '#b' }, { click: '#b' }],
});

behaves('conditional: a return-only tail selects text and markup with a shared fallthrough', {
  source: `export function App() {
    let a = false, b = false;
    if (a) {
      if (b) return <i id="x" onClick={() => b = false}>ab</i>;
    } else if (b) {
      return 'only b';
    }
    return <main><button id="a" onClick={() => a = !a}>a</button><button id="b" onClick={() => b = !b}>b</button></main>;
  }`,
  steps: [{ click: '#b' }],
});

behaves('conditional: a switch case returns a nested ternary and falls through', {
  source: `export function App() {
    let tab = 'a', on = false;
    switch (tab) {
      case 'a':
        return on ? <b id="t" onClick={() => tab = 'b'}>on</b> : <i id="t" onClick={() => on = true}>off</i>;
      case 'b':
        if (on) return <u id="t" onClick={() => on = false}>b on</u>;
        // falls through
      default:
        return <s id="t" onClick={() => tab = 'a'}>default</s>;
    }
  }`,
  steps: [{ click: '#t' }, { click: '#t' }, { click: '#t' }, { click: '#t' }],
});

behaves('conditional: stored conditional JSX and an early return share state', {
  source: `export function App() {
    let n = 0;
    const badge = n > 1 ? <b>many</b> : <i>few</i>;
    if (n === 0) return <button onClick={() => n++}>start</button>;
    return <main>{badge}<button onClick={() => n++}>{n}</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }, { click: 'button' }],
});

behaves('conditional: logical and nullish selections read values from a deferred segment', {
  source: `export function App() {
    let user = null, shown = false;
    if (!shown) return <button onClick={() => { shown = true; user = { name: 'Ada' }; }}>show</button>;
    const name = user?.name ?? null;
    return <main>{name && <b>{name}</b>}{name ?? <i>none</i>}<button onClick={() => user = null}>clear</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});
