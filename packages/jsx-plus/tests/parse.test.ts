import { expect, it } from 'bun:test';
import { parse } from 'yuku-parser';
import fixtures from '../../../wiki2/spec/cases.json';
import { authoredOffset, JsxPlusError, normalize } from '../src';

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

it('points missing sibling separators at the intended opening tag', () => {
  let caught: unknown;
  try { normalize('<p>"Label"\n<input /></p>'); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(JsxPlusError);
  expect((caught as JsxPlusError).code).toBe('JPX1005');
  expect((caught as JsxPlusError).range).toEqual([11, 20]);
});
