import { expect, it } from 'bun:test';
import { compile, normalize, authoredOffset, JsxPlusError } from '../src';

for (const [source, expected] of [
  ['<button onClick=addTask />', '<button onClick={addTask} />'],
  ['<button onClick=addTask/>', '<button onClick={addTask}/>'],
  ['<p title=x>"hi"</p>', '<p title={x}>{"hi"}</p>'],
  ['<Box ref=input value=x title=(label) other={value} />', '<Box ref={input} value={x} title={(label)} other={value} />'],
  ['<button onClick =\r\n addTask disabled />', '<button onClick =\r\n {addTask} disabled />'],
  ['<button onClick=$add />', '<button onClick={$add} />'],
  ['<Box value=caf\u00e9 />', '<Box value={caf\u00e9} />'],
  [String.raw`<button onClick=\u0061ddTask />`, String.raw`<button onClick={\u0061ddTask} />`],
] as const) {
  it(`normalizes the bare identifier in ${source}`, () => {
    const result = normalize(source);
    expect(result.code).toBe(expected);
    for (const mapping of result.mappings) {
      expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
    }
  });
}

for (const [source, value] of [
  ['<button onClick=addTask() />', 'addTask()'],
  ['<button onClick=handlers.add />', 'handlers.add'],
  ['<Box value=first+second />', 'first+second'],
  ['<Box value=foo-bar />', 'foo-bar'],
  ['<Box value=true />', 'true'],
  ['<Box value=123 />', '123'],
  ['<Box value=a/b />', 'a/b'],
  ['<Box value=first+second>"x"</Box>', 'first+second'],
] as const) {
  it(`reports JPX1009 over the undelimited value in ${source}`, () => {
    const start = source.indexOf(value);
    expect(() => normalize(source)).toThrow(expect.objectContaining({ code: 'JPX1009', range: [start, start + value.length] }));
  });
}

it('treats a space after a bare identifier as the end of the value', () => {
  // `addTask` is a complete value; the following `()` is not an attribute.
  expect(() => normalize('<button onClick=addTask () />')).toThrow(JsxPlusError);
});

it('leaves generated braces unmapped around a copied bare handler name', () => {
  const source = '<button onClick=addTask />';
  const result = normalize(source);
  expect(authoredOffset(result.mappings, result.code.indexOf('{'))).toBeUndefined();
  expect(authoredOffset(result.mappings, result.code.indexOf('addTask'))).toBe(source.indexOf('addTask'));
  expect(() => compile(`export function App() { return ${source}; }`, { moduleId: './App.tsx' })).toThrow();
});

for (const [name, source, expected] of [
  ['named value', '<button aria-label=("Remove " + task.title) />', '<button aria-label={("Remove " + task.title)} />'],
  ['comparison and callback', '<button disabled=(value > 1) onClick=(() => value++) />', '<button disabled={(value > 1)} onClick={(() => value++)} />'],
  ['mixed delimiters', '<Box one=(value) two={other} three=(last) />', '<Box one={(value)} two={other} three={(last)} />'],
  ['nested markup', '<Box content=(ready ? <b>"yes"</b> : <i>"no"</i>) />', '<Box content={(ready ? <b>{"yes"}</b> : <i>{"no"}</i>)} />'],
  ['nested attribute', '<Box render=(() => <p title=(name)>"hello"</p>) />', '<Box render={(() => <p title={(name)}>{"hello"}</p>)} />'],
  ['existing container', '<Box render={() => <p title=(name)>"hello"</p>} />', '<Box render={() => <p title={(name)}>{"hello"}</p>} />'],
  ['object and function', '<Box value=({ read: () => ({ value: 1 }) }.read().value) />', '<Box value={({ read: () => ({ value: 1 }) }.read().value)} />'],
  ['comma expression', '<Box value=(first(), last()) />', '<Box value={(first(), last())} />'],
  ['generic callback', '<Box value=(<T,>(item: T) => item) />', '<Box value={(<T,>(item: T) => item)} />'],
  ['template literals', '<Box value=(`a ${read("( > )")} ${`b ${value}`}`) />', '<Box value={(`a ${read("( > )")} ${`b ${value}`}`)} />'],
  ['regex', String.raw`<Box value=(/\)/.test(text)) />`, String.raw`<Box value={(/\)/.test(text))} />`],
  ['comments', '<Box value=(/* ) > */ (read() > 1)) />', '<Box value={(/* ) > */ (read() > 1))} />'],
] as const) {
  it(`normalizes parenthesized attributes with ${name}`, () => {
    expect(normalize(source).code).toBe(expected);
  });
}

it('retains exact UTF-16/CRLF mappings and leaves only inserted braces unmapped', () => {
  const source = '<button\r\n aria-label=("😀 " + task.title) />';
  const result = normalize(source);
  for (const mapping of result.mappings) {
    expect(result.code.slice(...mapping.generated)).toBe(source.slice(...mapping.authored));
  }
  const name = result.code.indexOf('task.title');
  expect(authoredOffset(result.mappings, name)).toBe(source.indexOf('task.title'));
  expect(authoredOffset(result.mappings, result.code.indexOf('{'))).toBeUndefined();
  expect(authoredOffset(result.mappings, result.code.indexOf('('))).toBe(source.indexOf('('));
});

it('keeps parenthesized attribute values specific to the extended format', () => {
  const source = 'export function App() { return <input title=("Hello") />; }';
  expect(() => compile(source, { moduleId: './App.tsx' })).toThrow();
});

for (const source of [
  '<input title=("missing />',
  '<input title=(/* "comment" */ "missing />',
  '<input title=(`missing ${name} />',
  '<input title=(`nested ${"missing} />',
]) {
  it(`reports the authored literal opener in ${source}`, () => {
    let caught: unknown;
    try {
      normalize(source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsxPlusError);
    const quote = source.includes('"missing') ? source.indexOf('"missing') : source.indexOf('`');
    expect(caught).toMatchObject({ code: 'JPX1003', range: [quote, quote + 1] });
  });
}

// An attribute `{` that never closes, or that a later unrelated `}` closes, would
// swallow the rest of the file; the error names that `{` (diagnostics.md, r6).
for (const source of [
  '<main><input onInput={event => go(event)\n  /><p>"after"</p></main>',
  'function App() {\n  return <main><input onInput={event => go(event)\n  /><nav>if (open) { <p>"x"</p> }</nav></main>;\n}',
]) {
  it(`reports an unclosed attribute brace at its \`{\`: ${JSON.stringify(source.slice(0, 40))}`, () => {
    const brace = source.indexOf('{event');
    expect(() => normalize(source)).toThrow(expect.objectContaining({ code: 'HOST', range: [brace, brace + 1] }));
  });
}
