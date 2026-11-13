import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../src';
import { projectForChecking } from '../src/checking/project';

const app = readFileSync(new URL('../examples/task-board/App.auwla', import.meta.url), 'utf8');
const lineEnding = app.includes('\r\n') ? '\r\n' : '\n';

for (const [name, source, code, opener] of [
  ['quote', app.replace('"Make room for the next idea."', '"Make room for the next idea.'), 1003, '"Make room'],
  ['attribute parenthesis', app.replace('aria-label=("Remove " + task.title)', 'aria-label=("Remove " + task.title'), 1008, '("Remove "'],
  ['bare member value', app.replace('onClick=focusTaskInput', 'onClick=actions.focus'), 1009, 'actions.focus'],
  ['child comma', app.replace('"Add task"', '"Add", task'), 1005, ', task'],
] as const) {
  it(`keeps current task-board code outside a damaged ${name} line available for checking`, () => {
    const result = projectForChecking(source, './App.auwla');
    const damaged = source.indexOf(opener);
    expect(result.diagnostics?.[0]).toMatchObject({ code, start: damaged });
    expect(result.text).toContain('function removeTask');
    expect(result.text).toContain('task.title');
    // Quotes and parentheses are now repaired with an unmapped closer, keeping
    // the authored expression checkable. Other damage still needs quarantine.
    const preserved = code === 1003 || code === 1008;
    expect(result.mappings.some(([, , start, length]) => start <= damaged && damaged < start + length)).toBe(preserved);
    for (const [start, length, original, size] of result.mappings) {
      expect(length).toBe(size);
      expect(result.text.slice(start, start + length)).toBe(source.slice(original, original + size));
    }
    expect(() => compile(source)).toThrow();
  });
}

const damagedLabel = (source: string) => source.replace('aria-label=("Remove " + task.title)', 'aria-label=("Remove " + task.title');

for (const [where, source, hostError] of [
  ['before the markup', damagedLabel(app.replace("let query = '';", "let query = ('';")), "let query = ('';"],
  ['after the markup', damagedLabel(app) + '\nexport const later = (;\n', 'export const later = (;'],
] as const) {
  it(`keeps damaged markup recoverable beside an ordinary host syntax error ${where}`, () => {
    const result = projectForChecking(source, './App.auwla');
    const damaged = source.indexOf('("Remove "');
    const host = source.indexOf(hostError);
    // The markup error is reported by JSX+; the host error stays mapped for TypeScript.
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 1008, start: damaged })]);
    expect(result.text).toContain(hostError);
    expect(result.text).toContain('function removeTask');
    expect(result.mappings.some(([, , start, length]) => start <= damaged && damaged < start + length)).toBe(true);
    expect(result.mappings.some(([, , start, length]) => start <= host && host < start + length)).toBe(true);
  });
}

/** Every mapped character, including text after inserted closers, is authored verbatim. */
function expectExactMappings(source: string, result: ReturnType<typeof projectForChecking>) {
  for (const [start, length, original, size] of result.mappings) {
    expect(length).toBe(size);
    expect(result.text.slice(start, start + length)).toBe(source.slice(original, original + size));
  }
}

// Half-finished edits, each with its diagnostic code and the text the diagnostic
// starts at (searched from the edit). Recovery inserts a closer or sets aside
// an unclosed element's opening tag or a stray closing tag (recovery/markup.ts).
for (const [name, from, to, code, anchor] of [
  ['missing </ul>', '        </ul>\n', '', 1001, '</main>'],
  ['missing </button>', '              "Remove"\n              </button>', '              "Remove"\n', 1001, '</li>'],
  ['half-typed element', '<span>task.title</span>', '<sp\n<span>task.title</span>', 1001, '</span>'],
  ['lone <', '<span>task.title</span>', '<\n<span>task.title</span>', 1001, '</span>'],
  ['half-typed closing tag', '      </footer>', '      </fo', 1001, '</fo'],
  ['unclosed attribute brace', 'onInput={event => query = event.currentTarget.value}', 'onInput={event => query = event.currentTarget.value', 1999, '{event'],
  ['unclosed for header', 'for (const task of visible) {', 'for (const task of visible {', 1011, '(const task'],
  ['missing attribute value', '<button type="submit">', '<button type="submit" class=>', 1009, '>"Add task"'],
] as const) {
  it(`recovers the rest of the task board around a ${name}`, () => {
    // Keep the damaged edit identical on LF and CRLF checkouts. Otherwise a
    // multiline search can miss and leave a valid, undamaged example behind.
    const original = from.replaceAll('\n', lineEnding);
    const replacement = to.replaceAll('\n', lineEnding);
    expect(app).toContain(original);
    const source = app.replace(original, replacement);
    const damaged = source.indexOf(anchor, app.indexOf(original));
    const result = projectForChecking(source, './App.auwla');
    expect(result.text).not.toBe('export {};\n');
    expect(result.diagnostics?.[0]).toMatchObject({ code, start: damaged });
    expect(result.text).toContain('function removeTask');
    expectExactMappings(source, result);
    expect(() => compile(source)).toThrow();
  });
}

it('keeps a tag after text checked when the ";" between them is missing', () => {
  // The team example's error component, with the separator before its button removed.
  const people = readFileSync(new URL('../examples/team/pages/People.auwla', import.meta.url), 'utf8');
  const source = people.replace('" ";', '" "');
  expect(source).not.toBe(people);
  const button = source.indexOf('<button type="button" class="retry"');
  const result = projectForChecking(source, './People.auwla');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 1005, start: button })]);
  // The inserted `;` keeps the button and the rest of the file checked.
  const mapped = (offset: number) => result.mappings.some(([, , start, length]) => start <= offset && offset < start + length);
  expect(mapped(source.indexOf('retry()'))).toBe(true);
  expect(mapped(source.indexOf('$track(people)'))).toBe(true);
  expectExactMappings(source, result);
  expect(() => compile(source)).toThrow(expect.objectContaining({ code: 'JPX1005' }));
});

it('reports a half-typed closing tag once, not the good tag after it', () => {
  const source = app.replace('      </footer>', '      </fo');
  expect(projectForChecking(source, './App.auwla').diagnostics).toHaveLength(1);
});

it('keeps an unfinished child string and its host declaration checked on the same line', () => {
  // A checking-only closing quote preserves both the declaration and the string.
  const source = app.replace('  function removeTask', '  const banner = <p>"oops\n  </p>;\n\n  function removeTask');
  const result = projectForChecking(source, './App.auwla');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 1003, start: source.indexOf('"oops') })]);
  expect(result.text).toContain('const banner =');
  expect(result.text).toContain('<p>{"oops"}');
  expect(result.mappings.some(([, , start, length]) => start <= source.indexOf('oops') && source.indexOf('oops') < start + length)).toBe(true);
  expectExactMappings(source, result);
});

it('inserts a missing closing quote, so the line being typed stays checked', () => {
  // The `"` goes before `</p>` as unmapped text; everything authored on the line stays mapped.
  const source = app.replace('  function removeTask', '  const banner = <p>"oops</p>; const other = (\n    1);\n\n  function removeTask');
  const result = projectForChecking(source, './App.auwla');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 1003, start: source.indexOf('"oops') })]);
  expect(result.text).toContain('<p>{"oops"}</p>; const other = (');
  const mapped = (offset: number) => result.mappings.some(([, , start, length]) => start <= offset && offset < start + length);
  expect(mapped(source.indexOf('oops'))).toBe(true);
  expect(mapped(source.indexOf('const other'))).toBe(true);
  expectExactMappings(source, result);
});

it('maps multiple repairs and their diagnostics back through UTF-16 and CRLF text', () => {
  const source = ('// \u{1f600}\n' + damagedLabel(app)
    .replace('"Make room for the next idea."', '"Make room for the next idea.'))
    .replace(/\r?\n/g, '\r\n');
  const result = projectForChecking(source, './App.auwla');
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: 1003, start: source.indexOf('"Make room') }),
    expect.objectContaining({ code: 1008, start: source.indexOf('("Remove "') }),
  ]);
  expect(result.text).toContain('Make room for the next idea.');
  expect(result.text).toContain('("Remove " + task.title)');
  expectExactMappings(source, result);
  expect(() => compile(source)).toThrow();
});

it('keeps the empty fallback when every repair would remove host code the next line needs', () => {
  // No closer fixes a child comma, and setting aside `const other = (` leaves
  // `1);` as a host error the quarantine caused, not the author's.
  const source = app.replace('  function removeTask', '  const banner = <p>tasks, nextId</p>; const other = (\n    1);\n\n  function removeTask');
  const result = projectForChecking(source, './App.auwla');
  expect(result.text).toBe('export {};\n');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 1005, start: source.indexOf(', nextId') })]);
});

it('leaves ordinary incomplete host syntax mapped for native TypeScript recovery', () => {
  const source = app.replace("let query = '';", "let query = ('';");
  const result = projectForChecking(source, './App.auwla');
  expect(result.text).toContain("let query = ('';");
  expect(result.text).toContain('function removeTask');
  expect(result.diagnostics).toBeUndefined();
  expect(() => compile(source)).toThrow();
});
