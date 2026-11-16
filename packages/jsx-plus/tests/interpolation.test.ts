import { expect, it } from 'bun:test';
import { normalize, JsxPlusError } from '../src';

for (const [name, source, expected] of [
  ['double quotes', '<p>"Count: {count}"</p>', '<p>{`Count: ${count}`}</p>'],
  ['single quotes', "<p>'Count: {count}'</p>", '<p>{`Count: ${count}`}</p>'],
  ['same-quote expression', '<p>"{ok ? "yes" : "no"}"</p>', '<p>{`${ok ? "yes" : "no"}`}</p>'],
  ['nested object', '<p>"{({ value: "}" }).value}"</p>', '<p>{`${({ value: "}" }).value}`}</p>'],
  ['regex and comments', '<p>"{/}/.test(text) /* } */}"</p>', '<p>{`${/}/.test(text) /* } */}`}</p>'],
  ['tag-like comparison with regex', '<p>"{value</p>/.test(text)}"</p>', '<p>{`${value</p>/.test(text)}`}</p>'],
  ['literal backtick', '<p>"Tick ` {value}"</p>', '<p>{`Tick \\` ${value}`}</p>'],
  ['escaped opening brace', String.raw`<p>"Literal \{x} and {value}"</p>`, '<p>{`Literal \\{x} and ${value}`}</p>'],
  ['literal dollar prefix', '<p>"Cost ${value}"</p>', '<p>{`Cost $${value}`}</p>'],
  ['ordinary call argument', '<p>format("{value}")</p>', '<p>{format("{value}")}</p>'],
  ['ordinary parenthesized string', '<p>("{value}")</p>', '<p>{("{value}")}</p>'],
  ['an attribute beside text', '<p title="{value}">"Count {value}"</p>', '<p title={`${value}`}>{`Count ${value}`}</p>'],
  ['method continuation', '<p>"Name {value}".toUpperCase()</p>', '<p>{`Name ${value}`.toUpperCase()}</p>'],
] as const) {
  it(`normalizes interpolation with ${name}`, () => {
    const result = normalize(source);
    expect(result.code).toBe(expected);
    for (const mapping of result.mappings) {
      expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
    }
  });
}

// G-INTERP in attribute strings (revision 10).
for (const [name, source, expected] of [
  ['a class list', '<div class="card {size}" />', '<div class={`card ${size}`} />'],
  ['the attribute quote inside', '<div class="a {on ? "x" : "y"} b" id="k" />', '<div class={`a ${on ? "x" : "y"} b`} id="k" />'],
  ['single quotes', "<a href='/people/{person.id}'>\"x\"</a>", '<a href={`/people/${person.id}`}>{"x"}</a>'],
  ['a space around the equals sign', '<div class = "a {b}" />', '<div class = {`a ${b}`} />'],
  ['an escaped brace', String.raw`<input pattern="\d\{3}{n}" />`, String.raw`<input pattern={${'`'}\\d\{3}${'${n}'}${'`'}} />`],
  ['a literal backtick and dollar', '<i data-x="`a` ${b}" />', '<i data-x={`\\`a\\` $${b}`} />'],
  ['markup in a substitution', '<i render="{<b>"x"</b>}" />', '<i render={`${<b>{"x"}</b>}`} />'],
  ['a comma expression', '<i title="{a, b}" />', '<i title={`${a, b}`} />'],
  ['a lone closing brace', '<i title="x } {y}" />', '<i title={`x } ${y}`} />'],
] as const) {
  it(`interpolates an attribute string with ${name}`, () => {
    const result = normalize(source);
    expect(result.code).toBe(expected);
    for (const mapping of result.mappings) {
      expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
    }
  });
}

for (const [name, source] of [
  ['no braces', '<i title="plain &amp; text" />'],
  ['a lone closing brace only', '<i title="x }" />'],
  ['a backslash', String.raw`<i title="C:\path" />`],
] as const) {
  it(`keeps an attribute string with ${name} as JSX`, () => {
    expect(normalize(source).code).toBe(source);
  });
}

it('reports a count-only attribute substitution, which a regex pattern would lose', () => {
  const source = String.raw`<input pattern="[a-z]{2,4}" />`;
  let caught: unknown;
  try { normalize(source); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: 'JPX1014', range: [source.indexOf('{'), source.indexOf('}') + 1] });
  expect((caught as JsxPlusError).reason).toContain(String.raw`write \{2,4}`);
});

for (const [name, source] of [
  ['an attribute', '<i title="{a b}" />'],
  ['an attribute holding JSON', `<i data-x='{"a": 1}' />`],
  ['quoted text', '<p>"x {a b}"</p>'],
] as const) {
  it(`reports a substitution that is not one expression in ${name}`, () => {
    expect(() => normalize(source)).toThrow(expect.objectContaining({
      code: 'JPX1014', range: [source.indexOf('{'), source.lastIndexOf('}') + 1],
    }));
  });
}

it('reports empty and unclosed attribute substitutions as quoted text does', () => {
  expect(() => normalize('<i title="{}" />')).toThrow(expect.objectContaining({ code: 'JPX1013', range: [10, 11] }));
  expect(() => normalize('<i title="{a" />')).toThrow(expect.objectContaining({ code: 'JPX1012', range: [10, 11] }));
});

it('keeps interpolation scopes and CRLF/UTF-16 mappings exact in direct child blocks', () => {
  const source = '<p>if (ready) { "\u{1f600} {value}\\\r\n next {other}" }</p>';
  const result = normalize(source);
  expect(result.code).toContain('${value}');
  expect(result.code).toContain('${other}');
  for (const mapping of result.mappings) {
    expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
  }
});

it('retains native host strings outside markup and inside interpolation expressions', () => {
  const source = 'const text = "{count}"; const node = <p>"{ok ? "{a}" : "{b}"}"</p>;';
  expect(normalize(source).code).toBe('const text = "{count}"; const node = <p>{`${ok ? "{a}" : "{b}"}`}</p>;');
});

it('reports trivia-only substitutions at their opening brace', () => {
  const source = '<p>"Count { /* comment */ }"</p>';
  expect(() => normalize(source)).toThrow(expect.objectContaining({
    code: 'JPX1013', range: [source.indexOf('{'), source.indexOf('{') + 1],
  }));
});

it('reports an unclosed outer quote after a valid substitution', () => {
  let error: unknown;
  try {
    normalize('<p>"Count {count}</p>');
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(JsxPlusError);
  expect(error).toMatchObject({ code: 'JPX1003', range: [3, 4] });
});
