import { expect, it } from 'bun:test';
import { parse } from 'yuku-parser';
import fixtures from '../../../wiki2/spec/cases.json';
import { authoredOffset, JsxPlusError, normalize } from '../src';
import { normalizeForChecking } from '../src/normalize';

for (const fixture of fixtures.cases) {
  if (fixture.level === 'parse') {
    it(`${fixture.id}: produces the authored syntax view`, () => {
      const result = normalize(fixture.source);
      expect({ specVersion: '0.1-draft', root: result.roots[0] } as unknown).toEqual(fixture.expected);
      expect(parse(result.code, { lang: 'tsx' }).diagnostics).toEqual([]);
    });
  } else if (fixture.level === 'diagnostics') {
    it(`${fixture.id}: reports the primary authored diagnostic`, () => {
      let caught: unknown;
      try { normalize(fixture.source, { filename: 'example.auwla' }); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(JsxPlusError);
      const error = caught as JsxPlusError;
      expect({ code: error.code, severity: 'error', range: error.range } as unknown).toEqual(fixture.expected);
      expect(error.filename).toBe('example.auwla');
    });
  }
}

for (const [name, source, expected] of [
  ['combining-mark element name', '<e\u0301>"x"</e\u0301>', '<e\u0301>{"x"}</e\u0301>'],
  ['astral element name', '<\u{10400}>"x"</\u{10400}>', '<\u{10400}>{"x"}</\u{10400}>'],
  ['quoted delimiters', '<p>"</p> <b>"</p>', '<p>{"</p> <b>"}</p>'],
  ['templates', '<p>`hello ${user.name}`</p>', '<p>{`hello ${user.name}`}</p>'],
  ['continued indexing', '<p>getValue()\n[index]</p>', '<p>{getValue()\n[index]}</p>'],
  ['separated indexing', '<p>getValue();\n[index]</p>', '<p>{getValue()}{[index]}</p>'],
  ['comparison and regex', '<p>(value < /p>/.test(text))</p>', '<p>{(value < /p>/.test(text))}</p>'],
  ['adjacent rows in a branch', '<div>if (ok) { <A/><B/> }</div>', '<div>{(ok)?<><A/><B/></>:null}</div>'],
  ['assignment condition', '<p>if (value = read()) { "yes" }</p>', '<p>{(value = read())?<>{"yes"}</>:null}</p>'],
  ['nested attribute markup', '<Box render={() => <p>"hello"</p>} />', '<Box render={() => <p>{"hello"}</p>} />'],
  ['comments', '<p>/* </p> */ "hello" // </p>\n</p>', '<p>{"hello"}</p>'],
  ['markup postfix', '<p><A />.value</p>', '<p>{<A />.value}</p>'],
  ['closing tag before later regex', '<p>"x"</p>; const pattern = /tail/;', '<p>{"x"}</p>; const pattern = /tail/;'],
  ['object expression', '<p>{ answer: 42 }.answer</p>', '<p>{{ answer: 42 }.answer}</p>'],
  ['function expression', '<p>function named() { return 1; }</p>', '<p>{function named() { return 1; }}</p>'],
  ['class expression', '<p>class { value = 1; }</p>', '<p>{class { value = 1; }}</p>'],
  ['function after another child', '<p>"a"; function named() { return 1; }</p>', '<p>{"a"}{function named() { return 1; }}</p>'],
] as const) {
  it(`normalizes ${name} through host tokens`, () => {
    expect(normalize(source).code).toBe(expected);
  });
}

for (const [name, source, comma] of [
  ['one expression', '<p>a, b</p>', 4],
  ['an ASI-separated statement', '<p>"x"\nb, c</p>', 8],
  ['a comma inside a comment first', '<p>a /* , */ , b</p>', 13],
  ['nested markup', '<p><A/>, <B/></p>', 7],
] as const) {
  it(`reports JPX1005 at a top-level child comma after ${name}`, () => {
    expect(source[comma]).toBe(',');
    expect(() => normalize(source)).toThrow(expect.objectContaining({ code: 'JPX1005', range: [comma, comma + 1] }));
  });
}

it('keeps parenthesized comma expressions and nested commas as ordinary host code', () => {
  expect(normalize('<p>(a, b); [a, b]; call(a, b)</p>').code).toBe('<p>{(a, b)}{[a, b]}{call(a, b)}</p>');
});

it('retains host code and TS generic arrows without detecting them as markup', () => {
  const source = 'const identity = <T,>(value: T) => value; const text = "<p>literal</p>"; export { identity, text };';
  const result = normalize(source);
  expect(result.code).toBe(source);
  expect(result.roots).toEqual([]);
});

it('maps copied expressions exactly and leaves generated braces unmapped', () => {
  const source = 'export function App() { return <p>"😀"; user.name</p>; }';
  const result = normalize(source);
  for (const mapping of result.mappings) {
    expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
  }
  const generated = result.code.indexOf('{"😀"');
  expect(authoredOffset(result.mappings, generated)).toBeUndefined();
  const identifier = result.code.indexOf('user.name');
  expect(authoredOffset(result.mappings, identifier)).toBe(source.indexOf('user.name'));
});

it('reports an authored Unicode/CRLF diagnostic position', () => {
  const source = '// 😀\r\n<p>"ok"</wrong>';
  expect(() => normalize(source, { filename: 'App.auwla' })).toThrow('App.auwla:2:8');
});

// G-BOUNDARY rule 5 with a tag that has a body: the host reads `"text" < name >`
// as a comparison, so without this the error was JPX1001 at the inner closer.
for (const [name, source, tag] of [
  ['text before a button', '<p>"Could not load. " <button>"Retry"</button></p>', '<button>'],
  ['an expression before a span', '<p>count <span>"x"</span></p>', '<span>'],
  ['text before nested markup', '<div>"a" <b><i>x</i></b></div>', '<b>'],
  ['text before a tag with attributes', '<p>"a" <a href="/x" class={kind}>"b"</a></p>', '<a href="/x" class={kind}>'],
  ['text before a fragment', '<div>"a" <>"x"</></div>', '<>'],
  ['text before a self-closing tag', '<p>"Label"\n<input /></p>', '<input />'],
] as const) {
  it(`reports JPX1005 for a missing ";" between ${name}`, () => {
    let caught: unknown;
    try { normalize(source); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(JsxPlusError);
    const error = caught as JsxPlusError;
    const at = source.indexOf(tag);
    expect({ code: error.code, range: error.range }).toEqual({ code: 'JPX1005', range: [at, at + tag.length] });
    expect(error.reason).toContain('needs ";"');
    expect(error.repairs).toEqual([{ kind: 'insert', at, text: ';' }]);
    // The suggested repair is the separated spelling, which normalizes.
    expect(() => normalize(source.slice(0, at) + ';' + source.slice(at))).not.toThrow();
  });
}

// The same mistake when the joined tag has its enclosing element's name: the inner closer
// matches, so the outer element closed early and the last closer failed elsewhere (a host
// regex error, or JPX1001 in a parent).
for (const [name, source, tag] of [
  ['two paragraphs', '<p>"a" <p>"b"</p></p>', '<p>'],
  ['two paragraphs inside a div', '<div><p>"a" <p>"b"</p></p></div>', '<p>'],
  ['two divs', '<div>"a" <div>"b"</div></div>', '<div>'],
  ['an expression before a section', 'function A() { return <section>count <section>"x"</section></section>; }', '<section>'],
] as const) {
  const at = source.lastIndexOf(tag);
  const expected = { code: 'JPX1005', range: [at, at + tag.length], repairs: [{ kind: 'insert', at, text: ';' }] } as const;
  const reported = (normalizeWith: (source: string) => unknown) => {
    try { normalizeWith(source); } catch (error) {
      const { code, range, repairs } = error as JsxPlusError;
      return { code, range, repairs };
    }
    return undefined;
  };

  it(`reports JPX1005 for a missing ";" between ${name}`, () => {
    expect(reported(normalize)).toEqual(expected);
    expect(() => normalize(source.slice(0, at) + ';' + source.slice(at))).not.toThrow();
  });

  it(`reports it in the editor too, for ${name}`, () => {
    expect(reported((text) => normalizeForChecking(text, './App.auwla'))).toEqual(expected);
  });
}

for (const [name, source, expected] of [
  ['a comparison', '<p>value < limit</p>', '<p>{value < limit}</p>'],
  ['a comparison that looks like a tag', '<b>x < b > y</b>', '<b>{x < b > y}</b>'],
  ['a comparison whose name ends at the closer', '<p>"a" <b>"x"</p>', '<p>{"a" <b>"x"}</p>'],
  ['the same comparison inside an element of that name', '<b><b>x < b > y</b></b>', '<b><b>{x < b > y}</b></b>'],
] as const) {
  it(`keeps ${name} as host code`, () => {
    expect(normalize(source).code).toBe(expected);
  });
}

it('still reports a plain mismatched closer as JPX1001', () => {
  expect(() => normalize('<p>count < limit</span></p>')).toThrow(expect.objectContaining({ code: 'JPX1001' }));
});

it('points missing sibling separators at the intended opening tag', () => {
  let caught: unknown;
  try { normalize('<p>"Label"\n<input /></p>'); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(JsxPlusError);
  expect((caught as JsxPlusError).code).toBe('JPX1005');
  expect((caught as JsxPlusError).range).toEqual([11, 20]);
});
