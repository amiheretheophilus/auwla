import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compile } from '../src';
import { projectForChecking } from '../src/checking/project';

const app = readFileSync(new URL('../examples/task-board/App.auwla', import.meta.url), 'utf8');

for (const [name, source, code, opener] of [
  ['quote', app.replace('"Make room for the next idea."', '"Make room for the next idea.'), 1003, '"Make room'],
  ['attribute parenthesis', app.replace('aria-label=("Remove " + task.title)', 'aria-label=("Remove " + task.title'), 1008, '("Remove "'],
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

it('leaves ordinary incomplete host syntax mapped for native TypeScript recovery', () => {
  const source = app.replace("let query = '';", "let query = ('';");
  const result = projectForChecking(source, './App.auwla');
  expect(result.text).toContain("let query = ('';");
  expect(result.text).toContain('function removeTask');
  expect(result.diagnostics).toBeUndefined();
  expect(() => compile(source)).toThrow();
});
