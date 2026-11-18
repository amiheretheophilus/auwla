/** `.auwla` is read with no import and no option (`built-in.ts`). */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';
import { createProject, type ProjectHost } from '../../project';
import { languageExtensions, languageOf, type SourceLanguage } from './languages';

const FILES = {
  './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './App.auwla'; mount('root', App);`,
  './App.auwla': `
export function App() {
  let count = 0;
  return <button onClick=(() => count++)>"Clicked {count} times"</button>;
}`,
};

describe('.auwla is built in', () => {
  it('compiles a .auwla module with no languages option', () => {
    const output = compileModules(FILES)['./App.auwla']!;
    // Compiled from JSX+: a template and a text slot, not JSX+ syntax.
    expect(output).toContain('createTemplateCache');
    expect(output).not.toContain('onClick=(');
  });

  it('a project reads .auwla with no languages option, also through an extensionless import', async () => {
    const files = { ...FILES, './main.ts': FILES['./main.ts'].replace("'./App.auwla'", "'./App'") };
    const host: ProjectHost = { readFile: (path) => files[path as keyof typeof files] };
    const build = await createProject({ entries: ['./main.ts'], host }).build();
    expect(build.ok).toBe(true);
    expect(build.ok && build.output['./App.auwla']).toContain('createTemplateCache');
  });

  it('reports a JSX+ error at its authored position', () => {
    expect(() => compileModules({ ...FILES, './App.auwla': 'export function App() { return <p>; }' }))
      .toThrow('./App.auwla:1:32');
  });

  it('another language is added before it, and one given for .auwla replaces it', () => {
    const other: SourceLanguage = { extensions: ['.other'], toTsx: (text) => ({ code: text, origin: {} as never }) };
    expect(languageExtensions(undefined)).toEqual(['.auwla']);
    expect(languageExtensions([other])).toEqual(['.other', '.auwla']);

    const own: SourceLanguage = { extensions: ['.auwla'], toTsx: (text) => ({ code: text, origin: {} as never }) };
    expect(languageOf('./App.auwla', [own])).toBe(own);
    expect(languageExtensions([own])).toEqual(['.auwla']);
  });
});
