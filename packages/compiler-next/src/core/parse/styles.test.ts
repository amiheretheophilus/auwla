/** Generated CSS is a source-language capability, independent of JSX+ syntax. */
import { expect, it } from 'bun:test';
import { compileModulesDetailed, createProject } from '../..';
import { UNEDITED } from './text-edits';
import type { SourceLanguage } from './languages';

const separator = '\n---css---\n';
const language: SourceLanguage = {
  extensions: ['.styled'],
  toTsx(text) {
    const start = text.indexOf(separator);
    if (start < 0) {
      return { code: text, origin: UNEDITED };
    }
    return { code: text.slice(0, start), origin: UNEDITED, stylesheet: text.slice(start + separator.length) };
  },
};

it('keeps CSS outside JavaScript and preserves directives before the generated import', () => {
  const source = `'use client';\nexport const value = 1;${separator}.card { color: red; }`;
  const result = compileModulesDetailed({ './nested/App.styled': source }, { languages: [language] });
  expect(result.output['./nested/App.styled']).toContain('use client');
  expect(result.output['./nested/App.styled']).toContain('./App.styled.css');
  expect(result.output['./nested/App.styled']).not.toContain('color: red');
  expect(result.css).toEqual({ './nested/App.styled.css': '.card { color: red; }' });
});

it('reports CSS-only edits and removal as project updates', async () => {
  let text = `export function App() { return <p>Hello</p>; }${separator}p { color: red; }`;
  const project = createProject({
    entries: ['./App.styled'], languages: [language],
    host: { readFile: (path) => path === './App.styled' ? text : undefined },
  });
  const first = await project.build();
  expect(first.ok).toBe(true);
  if (!first.ok) throw first.error;
  expect(first.stylesheets).toEqual(['./App.styled.css']);

  text = text.replace('red', 'blue');
  const edited = await project.update(['./App.styled']);
  expect(edited.build.ok).toBe(true);
  expect(edited.changed).toEqual(['./App.styled.css']);
  expect(edited.removed).toEqual([]);

  text = text.slice(0, text.indexOf(separator));
  const removed = await project.update(['./App.styled']);
  expect(removed.build.ok).toBe(true);
  expect(removed.changed).toEqual(['./App.styled']);
  expect(removed.removed).toEqual(['./App.styled.css']);
  if (!removed.build.ok) throw removed.build.error;
  expect(removed.build.css).toBeUndefined();
  expect(removed.build.stylesheets).toEqual([]);
});
