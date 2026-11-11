import { expect, it } from 'bun:test';
import { SpanMap, SpanMapFeature } from 'typescript/ast';
import { authoredOffset, JsxPlusError, normalize } from '../src';
import { projectForChecking } from '../src/checking/project';

// Direct `for...of` children (spec G-FOR / S-FOR).

for (const [name, source, expected] of [
  ['one keyed element as the row',
    '<ul>for (const task of tasks) { <li key={task.id}>task.title</li> }</ul>',
    '<ul>{Array.from(tasks, (task) => <li key={task.id}>{task.title}</li>)}</ul>'],
  ['several children as a fragment row',
    '<dl>for (const term of terms) { <dt>term.name</dt> <dd>term.text</dd> }</dl>',
    '<dl>{Array.from(terms, (term) => <><dt>{term.name}</dt><dd>{term.text}</dd></>)}</dl>'],
  ['an expression-only body',
    '<p>for (const word of words) { word; " " }</p>',
    '<p>{Array.from(words, (word) => <>{word}{" "}</>)}</p>'],
  ['a destructuring binding',
    '<ol>for (const [index, task] of tasks.entries()) { <li>index + 1; ". "; task.title</li> }</ol>',
    '<ol>{Array.from(tasks.entries(), ([index, task]) => <li>{index + 1}{". "}{task.title}</li>)}</ol>'],
  ['an empty body',
    '<ul>for (const task of tasks) {}</ul>',
    '<ul>{Array.from(tasks, (task) => <></>)}</ul>'],
  ['a loop nested in a loop',
    '<table>for (const row of rows) { <tr>for (const cell of row) { <td>cell</td> }</tr> }</table>',
    '<table>{Array.from(rows, (row) => <tr>{Array.from(row, (cell) => <td>{cell}</td>)}</tr>)}</table>'],
  ['a conditional inside a loop',
    '<ul>for (const task of tasks) { if (task.done) { <li>task.title</li> } }</ul>',
    '<ul>{Array.from(tasks, (task) => <>{(task.done)?<><li>{task.title}</li></>:null}</>)}</ul>'],
  ['a loop inside a conditional',
    '<ul>if (ready) { for (const task of tasks) { <li>task</li> } }</ul>',
    '<ul>{(ready)?<>{Array.from(tasks, (task) => <li>{task}</li>)}</>:null}</ul>'],
  ['a loop after markup on the same line',
    '<ul><li>"first"</li> for (const task of tasks) { <li>task</li> } <li>"last"</li></ul>',
    '<ul><li>{"first"}</li>{Array.from(tasks, (task) => <li>{task}</li>)}<li>{"last"}</li></ul>'],
  // G-BOUNDARY rule 4 (r5): this used to report a misleading JPX1007.
  ['a conditional after markup on the same line',
    '<ul><li>"first"</li> if (ready) { <li>"ok"</li> }</ul>',
    '<ul><li>{"first"}</li>{(ready)?<><li>{"ok"}</li></>:null}</ul>'],
] as const) {
  it(`normalizes ${name}`, () => {
    const result = normalize(source);
    expect(result.code).toBe(expected);
    // Copied text stays exact even though the iterable now precedes the binding.
    for (const mapping of result.mappings) {
      expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
    }
  });
}

it('keeps the binding and iterable exactly mapped and the generated call unmapped', () => {
  const source = '<ul>for (const task of tasks) { <li>task</li> }</ul>';
  const result = normalize(source);
  const generatedCall = result.code.indexOf('Array.from');
  expect(authoredOffset(result.mappings, generatedCall)).toBeUndefined();
  expect(authoredOffset(result.mappings, result.code.indexOf('tasks'))).toBe(source.indexOf('tasks'));
  expect(authoredOffset(result.mappings, result.code.indexOf('(task)') + 1)).toBe(source.indexOf('task'));

  // TypeScript's own map agrees, so renaming `task` edits the authored binding.
  const projected = projectForChecking(source, './App.auwla');
  const map = new SpanMap(projected.mappings.map(([virtualStart, virtualLength, originalStart, originalLength, kind]) => ({
    virtualStart, virtualEnd: virtualStart + virtualLength, originalStart, originalEnd: originalStart + originalLength, kind,
  })));
  const binding = projected.text.indexOf('(task)') + 1;
  const mapped = map.virtualToOriginalSpanForFeature({ pos: binding, end: binding + 4 }, SpanMapFeature.Rename);
  expect(SpanMap.isExact(mapped.fidelity)).toBe(true);
  expect(mapped.range).toEqual({ pos: source.indexOf('task'), end: source.indexOf('task') + 4 });
});

for (const source of [
  '<ul>for (let task of tasks) { task }</ul>',
  '<ul>for (var task of tasks) { task }</ul>',
  '<ul>for (task of tasks) { task }</ul>',
  '<ul>for (const key in record) { key }</ul>',
  '<ul>for (let index = 0; index < 3; index++) { index }</ul>',
  '<ul>for await (const task of tasks) { task }</ul>',
]) {
  it(`reports JPX1010 at the for keyword in ${source}`, () => {
    const start = source.indexOf('for');
    expect(() => normalize(source)).toThrow(expect.objectContaining({ code: 'JPX1010', range: [start, start + 3] }));
  });
}

it('rejects a statement inside a loop body', () => {
  expect(() => normalize('<ul>for (const task of tasks) { break }</ul>')).toThrow(JsxPlusError);
  expect(() => normalize('<ul>for (const task of tasks) { const label = task; label }</ul>')).toThrow(JsxPlusError);
});

it('rejects await in a loop body at its authored location', () => {
  // The body is a callback in the normalized program (S-FOR), so `await`
  // cannot keep its meaning there. Host validation reports it, not a crash.
  const source = 'export async function App() { return <ul>for (const id of ids) { <li>await load(id)</li> }</ul>; }';
  let caught: unknown;
  try {
    normalize(source);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(JsxPlusError);
  const range = (caught as JsxPlusError).range;
  expect(range[0]).toBeGreaterThanOrEqual(source.indexOf('await'));
  expect(range[0]).toBeLessThan(source.indexOf('load'));
});
