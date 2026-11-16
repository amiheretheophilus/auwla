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

// G-BOUNDARY rules 2 and 5 (revision 10): where the host would need a `;`, a new child
// starts, and `<` followed by a name after whitespace or quoted text starts a tag.
for (const [name, source, expected] of [
  ['text before a button', '<p>"Could not load. " <button>"Retry"</button></p>', '<p>{"Could not load. "}<button>{"Retry"}</button></p>'],
  ['an expression before a span', '<p>count <span>"x"</span></p>', '<p>{count}<span>{"x"}</span></p>'],
  ['text before nested markup', '<div>"a" <b><i>x</i></b></div>', '<div>{"a"}<b><i>{x}</i></b></div>'],
  ['text before a tag with attributes', '<p>"a" <a href="/x" class={kind}>"b"</a></p>', '<p>{"a"}<a href="/x" class={kind}>{"b"}</a></p>'],
  ['text before a fragment', '<div>"a" <>"x"</></div>', '<div>{"a"}<>{"x"}</></div>'],
  ['text before a tag on the next line', '<p>"Label"\n<input /></p>', '<p>{"Label"}<input /></p>'],
  ['quoted text touching a tag', '<p>"Price:"<b>price</b></p>', '<p>{"Price:"}<b>{price}</b></p>'],
  ['a tag then text on one line', '<p><span class="star">"✳"</span> "A little ambition."</p>', '<p><span class="star">{"✳"}</span>{"A little ambition."}</p>'],
  ['text, an expression and text', '<p>"Total: " count " people"</p>', '<p>{"Total: "}{count}{" people"}</p>'],
  ['two identifiers', '<p>first second</p>', '<p>{first}{second}</p>'],
  ['a tag between two texts', '<p>"common" <br /> "ground"</p>', '<p>{"common"}<br />{"ground"}</p>'],
  ['an operator expression and the next child', '<p>"a" + b c</p>', '<p>{"a" + b}{c}</p>'],
  ['a tag named like its parent', '<p>"a" <p>"b"</p></p>', '<p>{"a"}<p>{"b"}</p></p>'],
  ['a loop, text and a tag', '<ul>for (const x of xs) { <li>x</li> } "after" <i></i></ul>', '<ul>{Array.from(xs, (x) => <li>{x}</li>)}{"after"}<i></i></ul>'],
  ['children in a conditional block', '<p>if (ok) { "a" b <i></i> }</p>', '<p>{(ok)?<>{"a"}{b}<i></i></>:null}</p>'],
  ['an interpolated text then a tag', '<p>"Hi {name}" <b>"!"</b></p>', '<p>{`Hi ${name}`}<b>{"!"}</b></p>'],
  ['an interpolated text touching a tag', '<p>"Hi {name}"<b>"!"</b></p>', '<p>{`Hi ${name}`}<b>{"!"}</b></p>'],
  ['a template touching a tag', '<p>`Hi ${name}`<b>"!"</b></p>', '<p>{`Hi ${name}`}<b>{"!"}</b></p>'],
  ['the separator, still accepted', '<p>"a"; <b>"x"</b>; c</p>', '<p>{"a"}<b>{"x"}</b>{c}</p>'],
] as const) {
  it(`reads ${name} as separate children`, () => {
    expect(normalize(source).code).toBe(expected);
  });
}

// A piece that can continue the one before it still does, as in JavaScript.
for (const [name, source, expected] of [
  ['a call', '<p>label (x)</p>', '<p>{label (x)}</p>'],
  ['an index on the next line', '<p>items\n[0]</p>', '<p>{items\n[0]}</p>'],
  ['a generic call', '<p>format<string>(x)</p>', '<p>{format<string>(x)}</p>'],
] as const) {
  it(`keeps ${name} as one child`, () => {
    expect(normalize(source).code).toBe(expected);
  });
}

it('keeps a host error inside a function body as that error', () => {
  expect(() => normalize('<p>(() => { a b })</p>')).toThrow(expect.objectContaining({ code: 'JPX1005', range: [14, 15] }));
});

// Rule 5 with no space before the tag: `count<span>` stays a comparison, so the
// failure asks for the space that makes it a tag.
for (const [name, source, tag] of [
  ['an expression before a span', '<p>count<span>"x"</span></p>', '<span>'],
  ['an expression before nested markup', '<div>count<b><i>x</i></b></div>', '<b>'],
  ['an expression before a self-closing tag', '<p>count<input /></p>', '<input />'],
] as const) {
  it(`reports JPX1005 for a missing space between ${name}`, () => {
    let caught: unknown;
    try { normalize(source); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(JsxPlusError);
    const error = caught as JsxPlusError;
    const at = source.indexOf(tag);
    expect({ code: error.code, range: error.range }).toEqual({ code: 'JPX1005', range: [at, at + tag.length] });
    expect(error.reason).toContain('Put a space before this tag');
    expect(error.repairs).toEqual([{ kind: 'insert', at, text: ' ' }]);
    // The suggested repair normalizes.
    expect(() => normalize(source.slice(0, at) + ' ' + source.slice(at))).not.toThrow();
  });
}

// The same mistake when the joined tag has its enclosing element's name: the inner closer
// matches, so the outer element closed early and the last closer failed elsewhere (a host
// regex error, or JPX1001 in a parent).
for (const [name, source, tag] of [
  ['two paragraphs', '<p>count<p>"b"</p></p>', '<p>'],
  ['two paragraphs inside a div', '<div><p>count<p>"b"</p></p></div>', '<p>'],
  ['two divs', '<div>count<div>"b"</div></div>', '<div>'],
  ['an expression before a section', 'function A() { return <section>count<section>"x"</section></section>; }', '<section>'],
] as const) {
  const at = source.lastIndexOf(tag);
  const expected = { code: 'JPX1005', range: [at, at + tag.length], repairs: [{ kind: 'insert', at, text: ' ' }] } as const;
  const reported = (normalizeWith: (source: string) => unknown) => {
    try { normalizeWith(source); } catch (error) {
      const { code, range, repairs } = error as JsxPlusError;
      return { code, range, repairs };
    }
    return undefined;
  };

  it(`reports JPX1005 for a missing space between ${name}`, () => {
    expect(reported(normalize)).toEqual(expected);
    expect(() => normalize(source.slice(0, at) + ' ' + source.slice(at))).not.toThrow();
  });

  it(`reports it in the editor too, for ${name}`, () => {
    expect(reported((text) => normalizeForChecking(text, './App.auwla'))).toEqual(expected);
  });
}

for (const [name, source, expected] of [
  ['a comparison', '<p>value < limit</p>', '<p>{value < limit}</p>'],
  ['a comparison that looks like a tag', '<b>x < b > y</b>', '<b>{x < b > y}</b>'],
  ['the same comparison inside an element of that name', '<b><b>x < b > y</b></b>', '<b><b>{x < b > y}</b></b>'],
  ['a comparison written with no spaces', '<b>x<b>y</b>', '<b>{x<b>y}</b>'],
  ['a comparison inside parentheses', '<p>(a <b)</p>', '<p>{(a <b)}</p>'],
] as const) {
  it(`keeps ${name} as host code`, () => {
    expect(normalize(source).code).toBe(expected);
  });
}

it('still reports a plain mismatched closer as JPX1001', () => {
  expect(() => normalize('<p>count < limit</span></p>')).toThrow(expect.objectContaining({ code: 'JPX1001' }));
});

it('reads a name after text and a space as a tag, so a missing closer names that tag', () => {
  // Before revision 10 this was the comparison `"a" < b > "x"`.
  expect(() => normalize('<p>"a" <b>"x"</p>')).toThrow(expect.objectContaining({
    code: 'JPX1001', reason: 'Unexpected </p>; expected </b> to close <b>',
  }));
});
