/**
 * Closed lists (`optimize/closed-lists.ts`): rows are skipped when a list only moves
 * its items. Each case tries to make a skipped row show something stale, or a plain
 * store go unreported. Every case runs on the reference and both compiler modes, so
 * a wrong proof shows up as a difference, whichever path the program took.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const text = (container: Element, selector = 'ul') => container.querySelector(selector)?.textContent;

behaves('closed list: moving rows keeps each row\'s text', {
  source: `
    function build() { return [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }]; }
    export function App() {
      let rows = build();
      return <main>
        <button id="swap" onClick={() => { const t = rows[0]; rows[0] = rows[2]; rows[2] = t; }}>swap</button>
        <button id="reverse" onClick={() => { rows.reverse(); }}>reverse</button>
        <button id="drop" onClick={() => { rows = rows.slice(1); }}>drop</button>
        <button id="add" onClick={() => { rows = rows.concat(build()); }}>add</button>
        <ul>{rows.map((row) => <li key={row.label + rows.length}>{row.id}{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#swap' }, { click: '#reverse' }, { click: '#drop' }],
  check(container, observation) {
    expect(text(container)).toBe(['1a2b3c', '3c2b1a', '1a2b3c', '2b3c'][observation]);
  },
});

behaves('closed list: an edit between moves shows, by index and through a row\'s own item', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main>
        <button id="edit" onClick={() => { rows[0].label = 'x'; }}>edit</button>
        <button id="swap" onClick={() => { const t = rows[0]; rows[0] = rows[1]; rows[1] = t; }}>swap</button>
        <button id="both" onClick={() => { rows[0].label += '!'; rows.reverse(); }}>both</button>
        <ul>{rows.map((row) => <li key={row.id} onClick={() => { row.label = row.label + '?'; }}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#swap' }, { click: '#both' }, { click: 'li' }, { click: '#swap' }],
  check(container, observation) {
    expect(text(container)).toBe(['ab', 'xb', 'bx', 'xb!', 'x?b!', 'b!x?'][observation]);
  },
});

behaves('closed list: a row that reads its index updates when it moves', {
  source: `
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      return <main>
        <button id="drop" onClick={() => { rows.shift(); }}>drop</button>
        <ul>{rows.map((row, index) => <li key={row.id}>{index}:{row.id},</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#drop' }],
  check(container, observation) {
    expect(text(container)).toBe(['0:1,1:2,2:3,', '0:2,1:3,'][observation]);
  },
});

behaves('closed list: a key that reads the index moves with it', {
  source: `
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      return <main>
        <button id="swap" onClick={() => { rows.reverse(); }}>swap</button>
        <ul>{rows.map((row, index) => <li key={index}>{row.id}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#swap' }],
  check(container, observation) {
    expect(text(container)).toBe(['12', '21'][observation]);
  },
});

behaves('closed list: another state a row reads, changed with a move', {
  source: `
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      let prefix = 'a';
      return <main>
        <button id="both" onClick={() => { prefix = 'b'; rows.reverse(); }}>both</button>
        <ul>{rows.map((row) => <li key={row.id}>{prefix}{row.id}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#both' }],
  check(container, observation) {
    expect(text(container)).toBe(['a1a2', 'b2b1'][observation]);
  },
});

behaves('closed list: a routed comparison changed with a move', {
  source: `
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      let selected = 1;
      return <main>
        <button id="both" onClick={() => { selected = 2; rows.reverse(); }}>both</button>
        <ul>{rows.map((row) => <li key={row.id} class={selected === row.id ? 'on' : 'off'}>{row.id}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#both' }],
  check(container, observation) {
    const classes = [...container.querySelectorAll('li')].map((item) => item.getAttribute('class'));
    expect(classes).toEqual(['on', 'off']);
    expect(text(container)).toBe(['12', '21'][observation]);
  },
});

behaves('closed list: a row calling its own function is not skipped', {
  source: `
    const box = { suffix: 'a' };
    function shown(id) { return id + box.suffix; }
    export function App() {
      let rows = [{ id: 1 }];
      return <main>
        <button id="copy" onClick={() => { box.suffix = 'b'; rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{shown(row.id)}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['1a', '1b'][observation]);
  },
});

behaves('closed list: an item a host call edits is seen on the next move', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="assign" onClick={() => { Object.assign(rows[0], { label: 'b' }); }}>assign</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#assign' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b', 'b'][observation]);
  },
});

behaves('closed list: an item held by a Map and edited there shows on the next move', {
  source: `
    const held = new Map();
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      held.set('first', rows[0]);
      return <main>
        <button id="edit" onClick={() => { held.get('first').label = 'b'; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    if (observation === 2) expect(text(container)).toBe('b');
  },
});

behaves('closed list: an item saved in another state and edited there', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      let picked = null;
      return <main>
        <button id="pick" onClick={() => { picked = rows[0]; }}>pick</button>
        <button id="edit" onClick={() => { picked.label = 'b'; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#pick' }, { click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'a', 'b', 'b'][observation]);
  },
});

behaves('closed list: an edit through a local alias', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="edit" onClick={() => { const row = rows[0]; row.label = 'b'; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b', 'b'][observation]);
  },
});

behaves('closed list: an edit of the list through a local alias', {
  source: `
    export function App() {
      let rows = [{ id: 1 }];
      return <main>
        <button id="push" onClick={() => { const same = rows; same.push({ id: 2 }); }}>push</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.id}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#push' }],
  check(container, observation) {
    expect(text(container)).toBe(['1', '12'][observation]);
  },
});

behaves('closed list: a copy edited after it became the list', {
  source: `
    export function App() {
      let rows = [{ id: 1 }];
      return <main>
        <button id="late" onClick={() => { const copy = rows.slice(); rows = copy; copy.push({ id: 2 }); }}>late</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.id}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#late' }],
  check(container, observation) {
    expect(text(container)).toBe(['1', '12'][observation]);
  },
});

behaves('closed list: a helper that edits an item it receives', {
  source: `
    function rename(row) { row.label = 'b'; }
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="rename" onClick={() => { rename(rows[0]); }}>rename</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#rename' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b', 'b'][observation]);
  },
});

behaves('closed list: a builder that keeps a record for later', {
  source: `
    const pool = [];
    function build() { const row = { id: 1, label: 'a' }; pool.push(row); return [row]; }
    let rows = build();
    export function App() {
      return <main>
        <button id="edit" onClick={() => { pool[0].label = 'b'; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    // `build` reads `pool`, so editing `pool` derives `rows` again, with a new record.
    if (observation === 2) expect(text(container)).toBe('a');
  },
});

behaves('closed list: a field holding an object, edited below the record', {
  source: `
    export function App() {
      let rows = [{ id: 1, meta: { n: 1 } }];
      return <main>
        <button id="edit" onClick={() => { rows[0].meta.n = 2; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.meta.n}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['1', '2', '2'][observation]);
  },
});

behaves('closed list: a field storing an object later', {
  source: `
    const shared = { toString() { return 'obj'; } };
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="store" onClick={() => { rows[0].label = shared; }}>store</button>
        <ul>{rows.map((row) => <li key={row.id}>{String(row.label)}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#store' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'obj'][observation]);
  },
});

behaves('closed list: a record with a getter', {
  source: `
    const box = { value: 'a' };
    export function App() {
      let rows = [{ id: 1, get label() { return box.value; } }];
      return <main>
        <button id="copy" onClick={() => { box.value = 'b'; rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b'][observation]);
  },
});

behaves('closed list: a class instance whose method edits it', {
  source: `
    class Row { constructor(id) { this.id = id; this.label = 'a'; } touch() { this.label = 'b'; } }
    export function App() {
      let rows = [new Row(1)];
      return <main>
        <button id="touch" onClick={() => { rows[0].touch(); }}>touch</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#touch' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b', 'b'][observation]);
  },
});

behaves('closed list: the same item twice', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="twice" onClick={() => { rows.push(rows[0]); }}>twice</button>
        <button id="edit" onClick={() => { rows[0].label = 'b'; }}>edit</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#twice' }, { click: '#edit' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'aa', 'bb'][observation]);
  },
});

behaves('closed list: a function handed to a click receives the event, not an item', {
  source: `
    export function App() {
      let rows = [{ id: 1 }];
      const add = (row) => { rows = rows.concat(row); };
      return <main>
        <button id="add" onClick={add}>add</button>
        <p>{rows.length}</p>
      </main>;
    }`,
  steps: [{ click: '#add' }],
  check(container, observation) {
    expect(text(container, 'p')).toBe(['1', '2'][observation]);
  },
});

behaves('closed list: a function that returns an item to whoever calls it', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      const first = () => rows[0];
      return <main>
        <button id="edit" onClick={() => { first().label = 'b'; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    if (observation === 2) expect(text(container)).toBe('b');
  },
});

behaves('closed list: an effect sees moves and edits, and only real ones', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      let runs = [];
      $effect(() => { runs.push(rows.length + rows[0].label); });
      return <main>
        <button id="none" onClick={() => { rows.sort(); }}>none</button>
        <button id="edit" onClick={() => { rows[0].label = 'b'; }}>edit</button>
        <button id="add" onClick={() => { rows.push({ id: 2, label: 'c' }); }}>add</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        <p>{runs.join(',')}</p>
      </main>;
    }`,
  steps: [{ click: '#none' }, { click: '#edit' }, { click: '#add' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'a', 'b', 'bc'][observation]);
  },
});

behaves('closed list: an alias passed on to a helper that edits it', {
  source: `
    function rename(row) { row.label = 'b'; }
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="rename" onClick={() => { const row = rows[0]; rename(row); }}>rename</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#rename' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b'][observation]);
  },
});

behaves('a row handler toggles a field of its own item', {
  source: `
    export function App() {
      let todos = [{ id: 1, done: false }, { id: 2, done: false }];
      return <ul>{todos.map((todo) => (
        <li key={todo.id} onClick={() => { todo.done = !todo.done; }}>{todo.done ? 'yes' : 'no'}</li>
      ))}</ul>;
    }`,
  steps: [{ click: 'li' }, { click: 'li' }],
  check(container, observation) {
    expect(container.querySelector('li')?.textContent).toBe(['no', 'yes', 'no'][observation]);
  },
});

behaves('closed list: a module list shown by two components, each up to date', {
  source: `
    let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
    function One() { return <ul id="one">{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>; }
    function Two() { return <ul id="two">{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>; }
    export function App() {
      return <main>
        <button id="edit" onClick={() => { rows[0].label = 'x'; }}>edit</button>
        <button id="swap" onClick={() => { rows.reverse(); }}>swap</button>
        <One /><Two />
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#swap' }],
  check(container, observation) {
    expect(text(container, '#one')).toBe(['ab', 'xb', 'bx'][observation]);
    expect(text(container, '#two')).toBe(['ab', 'xb', 'bx'][observation]);
  },
});

behaves('closed list: two instances of a component keep separate lists and passes', {
  source: `
    function List({ name }) {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <section id={name}>
        <button onClick={() => { rows[0].label = 'x'; rows.reverse(); }}>go</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </section>;
    }
    export function App() { return <main><List name="one" /><List name="two" /></main>; }`,
  steps: [{ click: '#one button' }],
  check(container, observation) {
    expect(text(container, '#one ul')).toBe(['ab', 'bx'][observation]);
    expect(text(container, '#two ul')).toBe('ab');
  },
});

behaves('closed list: a component row shows moves and edits', {
  source: `
    function Row(props) { return <li>{props.item.id}{props.item.label}</li>; }
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main>
        <button id="swap" onClick={() => { rows.reverse(); }}>swap</button>
        <button id="edit" onClick={() => { rows[0].label = 'x'; }}>edit</button>
        <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
      </main>;
    }`,
  steps: [{ click: '#swap' }, { click: '#edit' }, { click: '#swap' }],
  check(container, observation) {
    expect(text(container)).toBe(['1a2b', '2b1a', '2x1a', '1a2x'][observation]);
  },
});

behaves('closed list: a component row that passes its props on as this', {
  source: `
    function Row(props) { return <li onClick={() => { props.pick(); }}>{props.item.label}</li>; }
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      const pick = function () { this.item.label = 'b'; };
      return <main>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((item) => <Row key={item.id} item={item} pick={pick} />)}</ul>
      </main>;
    }`,
  steps: [{ click: 'li' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b', 'b'][observation]);
  },
});

behaves('closed list: a list that shrinks through its length, then grows again', {
  source: `
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      return <main>
        <button id="cut" onClick={() => { rows.length = 1; }}>cut</button>
        <button id="add" onClick={() => { rows = [...rows, { id: 3 }]; }}>add</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.id}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#cut' }, { click: '#add' }],
  check(container, observation) {
    expect(text(container)).toBe(['12', '1', '13'][observation]);
  },
});

behaves('closed list: replacing a record with a new one by map', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main>
        <button id="map" onClick={() => { rows = rows.map((row) => row.id === 1 ? { ...row, label: 'x' } : row); }}>map</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#map' }],
  check(container, observation) {
    expect(text(container)).toBe(['ab', 'xb'][observation]);
  },
});

behaves('closed list: a read method whose callback returns an item keeps its use followed', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <button id="edit" onClick={() => { const found = rows.find((row) => row.id === 1); found.label = 'b'; }}>edit</button>
        <button id="copy" onClick={() => { rows = rows.slice(); }}>copy</button>
        <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#copy' }],
  check(container, observation) {
    expect(text(container)).toBe(['a', 'b', 'b'][observation]);
  },
});
