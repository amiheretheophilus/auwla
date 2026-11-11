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
  ['ordinary attribute', '<p title="{value}">"Count {value}"</p>', '<p title="{value}">{`Count ${value}`}</p>'],
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
