import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { normalize } from '../src';
import { projectForChecking } from '../src/checking/project';

const greeting = readFileSync(new URL('../examples/greeting.auwla', import.meta.url), 'utf8');

for (const [name, complete, partial] of [
  ['if member', 'if (name.length > 0)', 'if (name.)'],
  ['optional member', 'if (name.length > 0)', 'if (name?.)'],
  ['empty condition', 'if (name.length > 0)', 'if ()'],
  ['binary operand', 'if (name.length > 0)', 'if (name &&)'],
  ['computed member', 'if (name.length > 0)', 'if (name[])'],
  ['else-if member', 'name.trim().length === 0', 'name.trim().'],
  ['loop iterable', 'of model.rows', 'of model.'],
  ['row member', '>row.toUpperCase()</li>', '>row.</li>'],
  ['ternary member', ': name.toLowerCase()', ': name.'],
  ['parenthesized attribute', 'title=(name.toUpperCase())', 'title=(name.)'],
  ['brace attribute', 'title={row.toUpperCase()}', 'title={row.}'],
  ['quoted interpolation', '{name.toUpperCase()}"', '{name.}"'],
] as const) {
  for (const lineEnding of ['\n', '\r\n']) {
    it(`keeps an unfinished ${name} mapped with ${JSON.stringify(lineEnding)} line endings`, () => {
      const baseline = ('// 😀\n' + greeting).replace(/\r?\n/g, lineEnding);
      expect(baseline).toContain(complete);
      const source = baseline.replace(complete, partial);
      const checking = projectForChecking(source, './greeting.auwla');

      expect(checking.text).not.toBe('export {};\n');
      expect(checking.diagnostics).toBeUndefined();
      expect(checking.text).not.toContain('__auwla_edit__');
      expect(checking.text).toContain('Enter a name.');
      for (const [virtual, size, authored, length] of checking.mappings) {
        expect(size).toBe(length);
        expect(checking.text.slice(virtual, virtual + size)).toBe(source.slice(authored, authored + length));
      }

      // The incomplete member and its cursor remain authored edit locations.
      const start = source.indexOf(partial);
      const dot = partial.lastIndexOf('.');
      if (dot >= 0) {
        const offset = start + dot;
        expect(checking.mappings.some(([, , authored, size]) => authored <= offset && offset < authored + size)).toBe(true);
        expect(checking.mappings.some(([, , authored, size]) => authored <= offset + 1 && offset + 1 <= authored + size)).toBe(true);
      }
      expect(() => normalize(source)).toThrow();
    });
  }
}

it('preserves several unfinished conditions and their separate branch scopes', () => {
  const source = greeting
    .replace('if (name.length > 0)', 'if (name.)')
    .replace('name.trim().length === 0', 'name.trim().')
    .replace('of model.rows', 'of model.');
  const checking = projectForChecking(source, './greeting.auwla');
  expect(checking.diagnostics).toBeUndefined();
  expect(checking.text).toContain('(name.)?');
  expect(checking.text).toContain('(name.trim().)?');
  expect(checking.text).toContain('Array.from(model., (row) =>');
  expect(checking.text).not.toContain('__auwla_edit__');
});

it('does not reinterpret strings, comments or regex contents as expression holes', () => {
  const source = '<p>"name."; /name\\./.source; /* name. */ "done"</p>';
  expect(projectForChecking(source, './text.auwla').text).toBe(normalize(source).code);
});
