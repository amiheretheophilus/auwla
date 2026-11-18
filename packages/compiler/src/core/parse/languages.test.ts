/**
 * Source languages (`languages.ts`), with a toy language instead of a real one: the compiler must
 * not know any. `.toy` text is TSX with each line written after `> `. Its TSX drops those markers
 * and starts with a generated line, so lines and columns both move, and every authored position
 * differs from its analyzed one.
 */
import { describe, expect, it } from 'bun:test';
import { TraceMap, eachMapping } from '@jridgewell/trace-mapping';
import { compileModules, compileModulesDetailed, createProject, type ProjectHost } from '../..';
import { CompileError } from '../diagnostics';
import { importCandidates } from '../resolve/imports';
import type { SourceLanguage } from './languages';

const HEADER = '// written by the toy language\n';

const toy: SourceLanguage = {
  extensions: ['.toy'],
  toTsx(text, path) {
    const lines = text.split('\n');
    const bad = lines.findIndex((line) => line !== '' && !line.startsWith('> '));
    if (bad >= 0) throw new CompileError('a toy line starts with "> "', path, bad + 1, 1);

    // Where each TSX line starts, and where the authored line it came from starts.
    const starts: { readonly tsx: number; readonly authored: number }[] = [];
    let code = HEADER;
    let authored = 0;
    for (const line of lines) {
      starts.push({ tsx: code.length, authored: authored + (line === '' ? 0 : 2) });
      code += `${line.slice(2)}\n`;
      authored += line.length + 1;
    }
    return {
      code,
      origin: {
        original(offset) {
          // The generated header maps to the start of the file.
          let index = starts.length - 1;
          while (index > 0 && starts[index]!.tsx > offset) index--;
          const start = starts[index]!;
          return offset < start.tsx ? 0 : start.authored + offset - start.tsx;
        },
      },
    };
  },
};

/** `.toy` text from TSX lines. */
const written = (...lines: string[]) => lines.map((line) => `> ${line}`).join('\n');

const ROW = written(
  'export function Row({ label }) {',
  '  return <li>{label}</li>;',
  '}',
);

describe('source languages', () => {
  it('compiles a module a language owns under its own path, imported with or without its extension', () => {
    const output = compileModules({
      './Row.toy': ROW,
      './App.toy': written(
        "import { Row } from './Row.toy';",
        'export function App() {',
        '  let count = 0;',
        '  return <ul onClick={() => count++}><Row label={String(count)} /></ul>;',
        '}',
      ),
      './main.ts': "import { App } from './App';\nexport { App };",
    }, { languages: [toy] });

    expect(Object.keys(output).sort()).toEqual(['./App.toy', './Row.toy', './main.ts']);
    expect(output['./App.toy']).not.toContain('<ul');
    expect(output['./App.toy']).toContain("'./Row.toy'");
  });

  it('leaves the extension alone without the language', () => {
    expect(importCandidates('./Row', './App.tsx')).not.toContain('./Row.toy');
    expect(importCandidates('./Row', './App.tsx', ['.toy'])).toEqual(expect.arrayContaining(['./Row.toy', './Row/index.toy']));
    // The JavaScript and TypeScript extensions are tried first.
    const candidates = importCandidates('./Row', './App.tsx', ['.toy'])!;
    expect(candidates.indexOf('./Row.tsx')).toBeLessThan(candidates.indexOf('./Row.toy'));
  });

  it('reports the language\'s own error where the author wrote it', () => {
    const compile = () => compileModules({ './App.toy': `${ROW}\nnot a toy line` }, { languages: [toy] });
    expect(compile).toThrow(CompileError);
    expect(compile).toThrow('(./App.toy:4:1)');
  });

  it('moves a syntax error in its TSX back to the authored text', () => {
    // `let = ;` is on line 2 of the authored text, after `> `; in the TSX it is on line 3, column 1.
    const compile = () => compileModules({ './App.toy': written('const a = 1;', 'let = ;') }, { languages: [toy] });
    expect(compile).toThrow('(./App.toy:2:');
    const error = (() => { try { compile(); } catch (caught) { return caught as CompileError; } })()!;
    expect(error.line).toBe(2);
    expect(error.column).toBeGreaterThan(2);
  });

  it('moves an error found after parsing back to the authored text', () => {
    const source = written(
      "import { $fetch } from '@memoized-dom/data';",
      'export function App() {',
      "  const saved = $fetch('/save', { method: 'POST' });",
      '  return <p>{saved}</p>;',
      '}',
    );
    const compile = () => compileModules({ './App.toy': source }, { languages: [toy] });
    expect(compile).toThrow('POST action');
    const error = (() => { try { compile(); } catch (caught) { return caught as CompileError; } })()!;
    // The same program as `.tsx` reports the place in its own text, which here has no markers.
    const tsx = (() => {
      try {
        compileModules({ './App.tsx': source.split('\n').map((line) => line.slice(2)).join('\n') });
      } catch (caught) { return caught as CompileError; }
    })()!;
    expect([error.line, error.column]).toEqual([tsx.line, tsx.column! + 2]);
    expect(error.reason).toBe(tsx.reason);
  });

  it('maps output back to the authored text', () => {
    const { output, maps } = compileModulesDetailed({ './Row.toy': ROW }, { languages: [toy], sourceMaps: true });
    const map = maps!['./Row.toy']!;
    expect(map.sources).toEqual(['./Row.toy']);
    expect(map.sourcesContent).toEqual([ROW]);

    // Read with an independent consumer: each authored name the output prints maps to that name.
    const printed = output['./Row.toy']!;
    const name = /^[A-Za-z$][\w$]*/;
    const at = (text: string, line: number, column: number) => name.exec(text.split('\n')[line - 1]!.slice(column))?.[0];
    const seen: string[] = [];
    eachMapping(new TraceMap({ ...map, sources: [...map.sources], sourcesContent: [...map.sourcesContent], names: [] }), (mapping) => {
      if (mapping.originalLine === null) return;
      const word = at(printed, mapping.generatedLine, mapping.generatedColumn);
      if (word !== 'Row' && word !== 'label') return;
      expect(at(ROW, mapping.originalLine, mapping.originalColumn)).toBe(word);
      seen.push(word);
    });
    expect(seen).toEqual(expect.arrayContaining(['Row', 'label']));
  });

  it('collects a project through the language, and reports a module it rejects', async () => {
    const files: Record<string, string> = {
      './main.ts': "import { Row } from './Row';\nexport const row = Row;",
      './Row.toy': ROW,
    };
    const host: ProjectHost = { readFile: (path) => files[path] };
    const project = createProject({ entries: ['./main.ts'], host, languages: [toy] });

    const built = await project.build();
    expect(built.ok).toBe(true);
    expect([...built.modules].sort()).toEqual(['./Row.toy', './main.ts']);

    files['./Row.toy'] = `${ROW}\nbroken`;
    const failed = await project.update(['./Row.toy']);
    expect(failed.build.ok).toBe(false);
    if (!failed.build.ok) expect(failed.build.error.message).toContain('(./Row.toy:4:1)');

    // Without the language, the project does not read `.toy` files at all.
    const plain = await createProject({ entries: ['./main.ts'], host }).build();
    expect(plain.ok && plain.modules).toEqual(['./main.ts']);
  });
});
