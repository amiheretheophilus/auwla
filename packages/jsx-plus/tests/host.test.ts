import { expect, it } from 'bun:test';
import { parse } from 'yuku-parser';
import { JsxPlusError, normalize } from '../src';

for (const [name, source, expected] of [
  ['await', 'async function view() { return <p>await read()</p>; }',
    'async function view() { return <p>{await read()}</p>; }'],
  ['yield', 'function* view() { return <p>yield read()</p>; }',
    'function* view() { return <p>{yield read()}</p>; }'],
  ['yield between siblings', 'function* view() { return <p>"a"; yield read(); "z"</p>; }',
    'function* view() { return <p>{"a"}{yield read()}{"z"}</p>; }'],
  ['delegated yield', 'function* view() { return <p>yield* values</p>; }',
    'function* view() { return <p>{yield* values}</p>; }'],
  ['yielded markup', 'function* view() { return <p>yield <b>"pause"</b></p>; }',
    'function* view() { return <p>{yield <b>{"pause"}</b>}</p>; }'],
  ['yield in a condition', 'function* view() { return <p>if (yield read()) { "yes" }</p>; }',
    'function* view() { return <p>{(yield read())?<>{"yes"}</>:null}</p>; }'],
  ['yield in an attribute', 'function* view() { return <Box value={yield <b>"x"</b>} />; }',
    'function* view() { return <Box value={yield <b>{"x"}</b>} />; }'],
  ['async generator', 'async function* view() { return <p>yield await read()</p>; }',
    'async function* view() { return <p>{yield await read()}</p>; }'],
  ['ternary ending in markup', '<p>ok ? <b>"yes"</b> : <i>"no"</i></p>',
    '<p>{ok ? <b>{"yes"}</b> : <i>{"no"}</i>}</p>'],
  ['markup condition', '<p>if (<b>"test"</b>) { "yes" }</p>',
    '<p>{(<b>{"test"}</b>)?<>{"yes"}</>:null}</p>'],
  ['new.target', 'function View() { return <p>new.target</p>; }',
    'function View() { return <p>{new.target}</p>; }'],
  ['super', 'class View extends Base { render() { return <p>super.text</p>; } }',
    'class View extends Base { render() { return <p>{super.text}</p>; } }'],
  ['private member', 'class View { #text = "hi"; render() { return <p>this.#text</p>; } }',
    'class View { #text = "hi"; render() { return <p>{this.#text}</p>; } }'],
  ['template markup', '<p>`hello ${<b>"world"</b>}`</p>',
    '<p>{`hello ${<b>{"world"}</b>}`}</p>'],
  ['attribute template markup', '<Box label={`a ${first} b ${<b>"world"</b>}`} />',
    '<Box label={`a ${first} b ${<b>{"world"}</b>}`} />'],
  ['attribute template object', '<Box value={`a ${ { a: 1 }.a }`} label={x > y} />',
    '<Box value={`a ${ { a: 1 }.a }`} label={x > y} />'],
  ['object between siblings', '<p>"first"; { a: 1 }.a; "last"</p>',
    '<p>{"first"}{{ a: 1 }.a}{"last"}</p>'],
  ['anonymous function call between siblings', '<p>"first"; function() { return "middle"; }(); "last"</p>',
    '<p>{"first"}{function() { return "middle"; }()}{"last"}</p>'],
  ['class between siblings', '<p>"first"; class { value = 1; }; "last"</p>',
    '<p>{"first"}{class { value = 1; }}{"last"}</p>'],
  ['object siblings in a conditional', '<p>if (ok) { "first"; { a: 1 }.a; "last" }</p>',
    '<p>{(ok)?<>{"first"}{{ a: 1 }.a}{"last"}</>:null}</p>'],
  ['nested conditional object children', '<p>if (a) { if (b) { "x"; { n: 1 }.n } else { "y"; { n: 2 }.n } }</p>',
    '<p>{(a)?<>{(b)?<>{"x"}{{ n: 1 }.n}</>:<>{"y"}{{ n: 2 }.n}</>}</>:null}</p>'],
  ['semicolons in templates and calls', '<p>"first"; `a;${read(";")}`; (function() { return ";"; })()</p>',
    '<p>{"first"}{`a;${read(";")}`}{(function() { return ";"; })()}</p>'],
  ['ASI child separation', '<p>first\nsecond</p>', '<p>{first}{second}</p>'],
  ['addition continuation', '<p>first\n+second</p>', '<p>{first\n+second}</p>'],
] as const) {
  it(`preserves ${name} in its host context`, () => {
    const result = normalize(source);
    expect(result.code).toBe(expected);
    expect(parse(result.code, { lang: 'tsx', sourceType: 'module' }).diagnostics).toEqual([]);
    for (const mapping of result.mappings) {
      expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
    }
  });
}

it('keeps generator child ranges in the authored file', () => {
  const source = 'function* view() { return <p>yield read()</p>; }';
  const child = normalize(source).roots[0]!.children[0]!;
  expect(child.kind).toBe('expression');
  expect(child.range).toEqual([source.indexOf('yield'), source.indexOf('</p>')]);
  if (child.kind === 'expression') expect(child.source).toBe('yield read()');
});

it('retains exact ranges inside cached conditional child bodies', () => {
  const source = '<p>if (ok) { "first"; { a: 1 }.a; "last" }</p>';
  const conditional = normalize(source).roots[0]!.children[0]!;
  expect(conditional.kind).toBe('if');
  if (conditional.kind !== 'if') throw new Error('Expected a conditional view');
  const child = conditional.consequent.children[1]!;
  const start = source.indexOf('{ a:');
  const end = source.indexOf('; "last"');
  expect(child.range).toEqual([start, end]);
  expect(child).toEqual({ kind: 'expression', source: '{ a: 1 }.a', range: [start, end] });
});

for (const [name, source, code, range] of [
  ['unclosed conditional at EOF', '<p>if (ok) { "yes"', 'JPX1007', [11, 12]],
  ['incomplete conditional expression', '<p>if(ok) { value + }</p>', 'JPX1004', [20, 21]],
  ['unterminated template substitution', '<p>`hello ${value', 'JPX1003', [3, 4]],
  ['unterminated string before block/element errors', '<p>if(ok) { "oops', 'JPX1003', [12, 13]],
] as const) {
  it(`reports the authored location for ${name}`, () => {
    let caught: unknown;
    try { normalize(source); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(JsxPlusError);
    expect((caught as JsxPlusError).code).toBe(code);
    expect((caught as JsxPlusError).range).toEqual(range);
  });
}

it('does not make a yield expression legal outside a generator', () => {
  expect(() => normalize('function view() { return <p>yield read()</p>; }')).toThrow(JsxPlusError);
});

it('keeps a generator suspension in its authored function', () => {
  const source = 'function* view() { return <p>"before"; yield "pause"; "after"</p>; }';
  const normalized = normalize(source);
  // Use a plain JSX value factory to test native suspension, independently of
  // reactive compilation. No wrapper function may be emitted around the child.
  const transpiler = new Bun.Transpiler({ loader: 'tsx', tsconfig: {
    compilerOptions: { jsx: 'react', jsxFactory: 'element' },
  } });
  const javascript = transpiler.transformSync(normalized.code);
  const element = (tag: string, _props: unknown, ...children: unknown[]) => ({ tag, children });
  const view = new Function('element', `${javascript}; return view;`)(element) as () => Generator;
  const iterator = view();
  expect(iterator.next()).toEqual({ value: 'pause', done: false });
  expect(iterator.next('resumed')).toEqual({ value: {
    tag: 'p', children: ['before', 'resumed', 'after'],
  }, done: true });
});

it('keeps native await evaluation in its authored async function', async () => {
  const source = 'async function view() { return <p>await Promise.resolve("done")</p>; }';
  const transpiler = new Bun.Transpiler({ loader: 'tsx', tsconfig: {
    compilerOptions: { jsx: 'react', jsxFactory: 'element' },
  } });
  const javascript = transpiler.transformSync(normalize(source).code);
  const element = (tag: string, _props: unknown, ...children: unknown[]) => ({ tag, children });
  const view = new Function('element', `${javascript}; return view;`)(element) as () => Promise<unknown>;
  expect(await view()).toEqual({ tag: 'p', children: ['done'] });
});
