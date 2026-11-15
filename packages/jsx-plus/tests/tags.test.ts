import { expect, it } from 'bun:test';
import { normalize } from '../src/normalize';
import { projectForChecking } from '../src/checking/project';
import { closingTagAt } from '../src/editor/tags';

it('proposes authored closing tags and fragments using the shared markup frontend', () => {
  for (const [marked, expected] of [
    ['export const view = <div>|;', '</div>'],
    ['export const view = <>|;', '</>'],
    ['export const view = <UI.Card>|;', '</UI.Card>'],
    ['export const view = <svg:path>|;', '</svg:path>'],
    ['export const view = <$Card>|;', '</$Card>'],
    ['export const view = <section><button title=(name)>|</section>;', '</button>'],
    ['export const view = <><span>|</>;', '</span>'],
    ['export const view = <section><button>|', '</button>'],
    ['// 😀\r\nexport const view = <p>|;', '</p>'],
  ] as const) {
    const offset = marked.indexOf('|');
    const source = marked.replace('|', '');
    expect(closingTagAt(source, offset), marked).toBe(expected);
  }
});

it('leaves balanced tags, host operators, literals, comments, styles and self-closing tags alone', () => {
  for (const marked of [
    'export const view = <div>|</div>;',
    'export const view = <>|\n</>;',
    'export const view = <div>|"Hi"</div>;\nexport const broken = <p>',
    'export const view = <div>|<p></div>;',
    'export const view = <div>|"unfinished\n</div>;',
    'export const view = <button />|;',
    'export const view = <div title="hello >|">;',
    'export const view = <div title={a >| b}>;',
    'export const view = <p>"hello >|"</p>;',
    'export const view = <p>`hello >|`</p>;',
    'export const view = <p>"Hi {a >| b}"</p>;',
    'export const value = a >| b;',
    'export const value = a < b >| c;',
    'export const identity = <T,>|(value: T) => value;',
    'type Value = Array<string>|;',
    'const text = "<div>|";',
    'const text = `<div>|`;',
    '// <div>|',
    '/* <div>| */',
    '<style global>.a >| .b { color: red; }</style>',
  ]) {
    const offset = marked.indexOf('|');
    expect(closingTagAt(marked.replace('|', ''), offset), marked).toBeNull();
  }
  expect(closingTagAt('<div>', -1)).toBeNull();
  expect(closingTagAt('<div>', 6)).toBeNull();
  expect(closingTagAt('<div>', 4)).toBeNull();
});

it('names the missing or mismatched tag and retains authored diagnostic ranges', () => {
  for (const [source, code, message, anchor] of [
    ['export const view = <section>', 'JPX1002', 'Unclosed <section>; add </section> to close it', '<section>'],
    ['export const view = <>', 'JPX1002', 'Unclosed <>; add </> to close it', '<>'],
    ['export const view = <div></span>', 'JPX1001', 'Unexpected </span>; expected </div> to close <div>', '</span>'],
    ['export const view = <div></di', 'JPX1001', 'Incomplete closing tag; write </div> to close <div>', '</di'],
  ] as const) {
    expect(() => normalize(source, { filename: 'tags.auwla' })).toThrow(expect.objectContaining({
      code, reason: message, range: [source.indexOf(anchor), source.indexOf(anchor) + anchor.length],
    }));
  }
});

it('keeps incomplete root and nested tag names mapped before EOF or host closers', () => {
  for (const tail of ['<d', '<section><d', '<div>', '<>', '<section><p>"Hi"']) {
    for (const suffix of ['', '\n);\n}\nexport const after: string = 123;']) {
      const source = '// 😀\nexport function App() {\n  return (' + tail + suffix;
      const view = projectForChecking(source, 'tags.auwla');
      expect(view.text, source).not.toBe('export {};\n');
      expect(view.diagnostics?.length).toBeGreaterThan(0);
      for (const [generated, length, authored, authoredLength] of view.mappings) {
        expect(length).toBe(authoredLength);
        expect(view.text.slice(generated, generated + length)).toBe(source.slice(authored, authored + length));
      }
      if (tail.includes('<d')) {
        const name = source.indexOf('<d') + 1;
        expect(view.mappings.some(([, , start, length, , features]) =>
          features !== 0 && start <= name && name < start + length)).toBe(true);
      }
      if (suffix !== '') {
        expect(view.text).toContain('export const after: string = 123;');
      }
      expect(() => normalize(source, { filename: 'tags.auwla' })).toThrow();
    }
  }
});
