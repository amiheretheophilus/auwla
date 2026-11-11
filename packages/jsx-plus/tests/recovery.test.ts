import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../src';
import { projectForChecking } from '../src/checking/project';

const app = readFileSync(new URL('../examples/task-board/App.auwla', import.meta.url), 'utf8');

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
    expect(result.mappings.some(([, , start, length]) => start <= damaged && damaged < start + length)).toBe(false);
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
    expect(result.mappings.some(([, , start, length]) => start <= damaged && damaged < start + length)).toBe(false);
    expect(result.mappings.some(([, , start, length]) => start <= host && host < start + length)).toBe(true);
  });
}

it('keeps the empty fallback when the quarantined line also held host code', () => {
  // Blanking this line removes `const banner =` too, leaving `</p>;` as a host
  // statement: that error would be the quarantine's, not the author's.
  const source = app.replace('  function removeTask', '  const banner = <p>"oops\n  </p>;\n\n  function removeTask');
  const result = projectForChecking(source, './App.auwla');
  expect(result.text).toBe('export {};\n');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 1003, start: source.indexOf('"oops') })]);
});

it('leaves ordinary incomplete host syntax mapped for native TypeScript recovery', () => {
  const source = app.replace("let query = '';", "let query = ('';");
  const result = projectForChecking(source, './App.auwla');
  expect(result.text).toContain("let query = ('';");
  expect(result.text).toContain('function removeTask');
  expect(result.diagnostics).toBeUndefined();
  expect(() => compile(source)).toThrow();
});
