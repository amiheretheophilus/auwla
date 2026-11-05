/**
 * A leaf component that destructures its props is compiled as a row too
 * (`optimize/row-lists.ts`, `core/emit/row-list.ts`), and its list can be closed
 * (`optimize/closed-lists.ts`). Each case tries to make a row show something stale or
 * resolve a name differently. Every case runs on the reference and both compiler modes,
 * and shows the list's text after every step.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

function rows(name: string, source: string, steps: { click: string }[], expected: string[]): void {
  behaves(`destructured row: ${name}`, {
    source,
    steps,
    check(container, observation) {
      expect(container.querySelector('ul')?.textContent).toBe(expected[observation]);
    },
  });
}

rows('moves and edits', `
  function Row({ item }) { return <li>{item.id}{item.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
    return <main>
      <button id="swap" onClick={() => { rows.reverse(); }}>swap</button>
      <button id="edit" onClick={() => { rows[0].label = 'x'; }}>edit</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: '#swap' }, { click: '#edit' }, { click: '#swap' }], ['1a2b', '2b1a', '2x1a', '1a2x']);

rows('renamed and quoted fields, and one read twice', `
  function Row({ item: row, 'data-note': note, item: again }) { return <li>{row.id}{note}{again.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }];
    return <main>
      <button onClick={() => { rows = [{ id: 1, label: 'b' }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} data-note="!" />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['1!a', '1!b']);

rows('a field nothing passes', `
  function Row({ item, missing }) { return <li>{item.id}{String(missing)}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main>
      <button onClick={() => { rows = [{ id: 2 }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['1undefined', '2undefined']);

rows('no fields at all', `
  function Row({}) { return <li>row</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main>
      <button onClick={() => { rows = [{ id: 1 }, { id: 2 }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['row', 'rowrow']);

rows('a handler reads the item its row shows now', `
  function Row({ item, pick }) { return <li onClick={() => { pick(item.label); }}>{item.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }];
    let picked = '';
    const pick = (label) => { picked = label; };
    return <main>
      <button onClick={() => { rows = [{ id: 1, label: 'b' }]; }}>next</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} pick={pick} />)}{picked}</ul>
    </main>;
  }`, [{ click: 'li' }, { click: 'button' }, { click: 'li' }], ['a', 'aa', 'ba', 'bb']);

rows('a handler edits the item it destructured', `
  function Row({ item }) { return <li onClick={() => { item.label += '!'; }}>{item.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
    return <main>
      <button onClick={() => { rows = [rows[1], rows[0]]; }}>swap</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'li' }, { click: 'button' }, { click: 'li' }], ['ab', 'a!b', 'ba!', 'b!a!']);

rows('a called prop gets no this', `
  function Row({ item, pick }) { return <li onClick={() => { pick(); }}>{item.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }];
    const pick = function () { rows = [{ id: 1, label: String(this) }]; };
    return <main><ul>{rows.map((item) => <Row key={item.id} item={item} pick={pick} />)}</ul></main>;
  }`, [{ click: 'li' }], ['a', 'undefined']);

rows('a called prop edits the item it is passed', `
  function Row({ item, edit }) { return <li onClick={() => { edit(item); }}>{item.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }];
    const edit = (row) => { row.label = 'x'; };
    return <main>
      <button onClick={() => { rows = rows.slice(); }}>copy</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} edit={edit} />)}</ul>
    </main>;
  }`, [{ click: 'li' }, { click: 'button' }], ['a', 'x', 'x']);

rows('a called prop changes the list by id', `
  function Row({ item, remove }) { return <li onClick={() => { remove(item.id); }}>{item.id}</li>; }
  export function App() {
    let rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const remove = (id) => { rows = rows.filter((row) => row.id !== id); };
    return <main><ul>{rows.map((item) => <Row key={item.id} item={item} remove={remove} />)}</ul></main>;
  }`, [{ click: 'li' }, { click: 'li' }], ['123', '23', '3']);

rows('a called prop edits another item through the list', `
  function Row({ item, bump }) { return <li onClick={() => { bump(); }}>{item.n}</li>; }
  export function App() {
    let rows = [{ id: 1, n: 1 }, { id: 2, n: 2 }];
    const bump = () => { rows[1].n = 9; };
    return <main>
      <button onClick={() => { rows.reverse(); }}>swap</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} bump={bump} />)}</ul>
    </main>;
  }`, [{ click: 'li' }, { click: 'button' }], ['12', '19', '91']);

rows('a list kept and shown again by another name', `
  function Row({ item, keep }) { return <li onClick={() => { keep(item.id); }}>{item.label}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }];
    let held = null;
    const keep = (id) => { held = rows.find((row) => row.id === id); };
    return <main>
      <button onClick={() => { held.label = 'x'; }}>edit</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} keep={keep} />)}</ul>
    </main>;
  }`, [{ click: 'li' }, { click: 'button' }], ['a', 'a', 'x']);

rows('the index it is given moves with the row', `
  function Row({ item, at }) { return <li>{at}{item.id} </li>; }
  export function App() {
    let rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    return <main>
      <button onClick={() => { rows.reverse(); }}>go</button>
      <ul>{rows.map((item, index) => <Row key={item.id} item={item} at={index} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['01 12 23 ', '03 12 21 ']);

rows('a prop from the parent\'s state', `
  function Row({ item, suffix }) { return <li>{item.id}{suffix}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    let tick = 0;
    return <main>
      <button onClick={() => { tick++; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} suffix={'-' + tick} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['1-0', '1-1']);

rows('selection by a comparison passed as a prop', `
  function Row({ item, active, select }) {
    return <li class={active ? 'on' : ''} onClick={() => { select(item.id); }}>{item.id}{active ? '*' : ''}</li>;
  }
  export function App() {
    let rows = [{ id: 1 }, { id: 2 }];
    let selected = 1;
    const select = (id) => { selected = id; };
    return <main>
      <button id="swap" onClick={() => { rows.reverse(); }}>swap</button>
      <button id="none" onClick={() => { selected = 0; }}>none</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} active={selected === item.id} select={select} />)}</ul>
    </main>;
  }`, [{ click: 'li:last-child' }, { click: '#swap' }, { click: '#none' }], ['1*2', '12*', '2*1', '21']);

rows('selection read inside the row', `
  let selected = 1;
  function Row({ item, id }) { return <li>{item.label}{selected === id ? '*' : ''}{selected === item.id ? '+' : ''}</li>; }
  export function App() {
    let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
    return <main>
      <button id="two" onClick={() => { selected = 2; }}>two</button>
      <button id="swap" onClick={() => { rows = [rows[1], rows[0]]; }}>swap</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} id={item.id} />)}</ul>
    </main>;
  }`, [{ click: '#two' }, { click: '#swap' }], ['a*+b', 'ab*+', 'b*+a']);

rows('a field with the name of the module\'s state', `
  let selected = 1;
  function Row({ selected, item }) { return <li>{selected === item.id ? 'y' : 'n'}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main>
      <button onClick={() => { selected = 9; }}>module</button>
      <p>{selected}</p>
      <ul>{rows.map((item) => <Row key={item.id} item={item} selected={1} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['y', 'y']);

rows('a field with the name of a function of the module', `
  const format = (value) => value + '?';
  function Row({ item, format }) { return <li>{format(item.id)}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main>
      <button onClick={() => { rows = [{ id: 2 }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} format={(value) => value + '!'} />)}{format(0)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['1!0?', '2!0?']);

rows('a handler parameter that shadows a field', `
  function Row({ item }) { return <li onClick={(item) => { item.target.textContent = 'clicked'; }}>{item.id}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main><ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul></main>;
  }`, [{ click: 'li' }], ['1', 'clicked']);

rows('fields named like what the compiler generates', `
  function Row({ _props, _props2, _nextProps, _rowOwner, _invalidate }) {
    return <li>{_props}{_props2}{_nextProps}{_rowOwner}{_invalidate}</li>;
  }
  export function App() {
    let rows = [{ id: 1 }];
    let n = 0;
    return <main>
      <button onClick={() => { n++; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} _props={n} _props2="b" _nextProps="c" _rowOwner="d" _invalidate="e" />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['0bcde', '1bcde']);

rows('two lists share the component under different keys', `
  let selected = 1;
  function Row({ item }) { return <li>{item.id}{selected === item.id ? '*' : ''}</li>; }
  export function App() {
    let rows = [{ id: 1, other: 2 }, { id: 2, other: 1 }];
    return <main>
      <button onClick={() => { selected = 2; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}{rows.map((item) => <Row key={item.other} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['1*21*2', '12*12*']);

rows('the same component outside a list', `
  function Row({ item }) { return <li>{item.id}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    let one = { id: 9 };
    return <main>
      <button onClick={() => { one = { id: 8 }; rows = [{ id: 2 }]; }}>go</button>
      <ul><Row item={one} />{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['91', '82']);

rows('an item whose field holds an object', `
  function Row({ item, tags }) { return <li onClick={() => { tags.push('x'); }}>{item.id}{tags.join('')}</li>; }
  export function App() {
    let rows = [{ id: 1, tags: ['a'] }];
    return <main>
      <button onClick={() => { rows = [{ id: 1, tags: ['b'] }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} tags={item.tags} />)}</ul>
    </main>;
  }`, [{ click: 'li' }, { click: 'button' }], ['1a', '1ax', '1b']);

rows('an item with a getter', `
  function Row({ item }) { return <li>{item.label}</li>; }
  export function App() {
    let count = 0;
    let rows = [{ id: 1, get label() { return 'n' + count; } }];
    return <main>
      <button onClick={() => { count++; rows = rows.slice(); }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['n0', 'n1']);

rows('no key, and the list shrinks and grows', `
  function Row({ item }) { return <li>{item.id}</li>; }
  export function App() {
    let rows = [{ id: 1 }, { id: 2 }];
    return <main>
      <button id="cut" onClick={() => { rows = rows.slice(1); }}>cut</button>
      <button id="add" onClick={() => { rows = [...rows, { id: 3 }]; }}>add</button>
      <ul>{rows.map((item) => <Row item={item} />)}</ul>
    </main>;
  }`, [{ click: '#cut' }, { click: '#add' }], ['12', '2', '23']);

rows('a row that shows itself, removed', `
  function Row({ item }) { return <li>{item.id}<ul>{item.kids.map((kid) => <Row key={kid.id} item={kid} />)}</ul></li>; }
  export function App() {
    let rows = [{ id: 1, kids: [{ id: 2, kids: [] }] }];
    return <main>
      <button id="add" onClick={() => { rows[0].kids.push({ id: 3, kids: [] }); }}>add</button>
      <button id="clear" onClick={() => { rows = []; }}>clear</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: '#add' }, { click: '#clear' }], ['12', '123', '']);

// A closed list writes its leaf's text directly, whatever the leaf shows.
for (const [form, parameter, id, label] of [
  ['plain', 'props', 'props.item.id', 'props.item.label'],
  ['destructured', '{ item }', 'item.id', 'item.label'],
]) {
  rows(`text of every primitive in a ${form} row`, `
    function Row(${parameter}) { return <li>{${id}}:{${label}}|</li>; }
    export function App() {
      let rows = [{ id: 1, label: null }, { id: 2, label: undefined }, { id: 3, label: true }, { id: 4, label: 0 }, { id: 5, label: '' }];
      return <main>
        <button onClick={() => { rows[0].label = 'x'; rows[2].label = false; }}>go</button>
        <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
      </main>;
    }`, [{ click: 'button' }], ['1:|2:|3:|4:0|5:|', '1:x|2:|3:|4:0|5:|']);

  // The same leaf in a list that holds objects: only that list keeps the general text.
  rows(`a ${form} row in a closed list and in one that is not`, `
    function Row(${parameter}) { return <li>{${id}}{${label}}</li>; }
    export function App() {
      let closed = [{ id: 1, label: 'a' }];
      let open = [{ id: 2, label: ['b', 'c'] }];
      return <main>
        <button onClick={() => { closed = closed.slice(); open = [{ id: 2, label: ['d'] }]; }}>go</button>
        <ul>{closed.map((item) => <Row key={item.id} item={item} />)}{open.map((item) => <Row key={item.id} item={item} />)}</ul>
      </main>;
    }`, [{ click: 'button' }], ['1a2bc', '1a2d']);
}

// A row with nothing to clean up has no `dispose`, and its list must not call one.
for (const [form, parameter, read] of [['plain', 'props', 'props.item'], ['destructured', '{ item }', 'item']]) {
  rows(`nothing to clean up in a ${form} row, removed`, `
    function Row(${parameter}) { return <li class={${read}.id > 1 ? 'big' : 'small'}>row</li>; }
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      return <main>
        <button id="one" onClick={() => { rows = rows.slice(1); }}>one</button>
        <button id="clear" onClick={() => { rows = []; }}>clear</button>
        <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
      </main>;
    }`, [{ click: '#one' }, { click: '#clear' }], ['rowrow', 'row', '']);
}

// Patterns that do more than read a named prop stay general components, and still work.
rows('a default', `
  function Row({ item, note = 'n' + item.id }) { return <li>{note}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main>
      <button onClick={() => { rows = [{ id: 2 }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['n1', 'n2']);

rows('a rest', `
  function Row({ item, ...rest }) { return <li>{item.id}{Object.keys(rest).join('')}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main><ul>{rows.map((item) => <Row key={item.id} item={item} a="1" b="2" />)}</ul></main>;
  }`, [], ['1ab']);

rows('a nested pattern', `
  function Row({ item: { id } }) { return <li>{id}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main>
      <button onClick={() => { rows = [{ id: 2 }]; }}>go</button>
      <ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }`, [{ click: 'button' }], ['1', '2']);

rows('a field that a handler writes', `
  function Row({ item, note }) { return <li onClick={() => { note = 'local'; }}>{item.id}{note}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main><ul>{rows.map((item) => <Row key={item.id} item={item} note="given" />)}</ul></main>;
  }`, [{ click: 'li' }], ['1given', '1local']);

rows('a field called key stays out of the row form', `
  function Row({ key, item }) { return <li>{String(key)}{item.id}</li>; }
  export function App() {
    let rows = [{ id: 1 }];
    return <main><ul>{rows.map((item) => <Row key={item.id} item={item} />)}</ul></main>;
  }`, [], ['undefined1']);
