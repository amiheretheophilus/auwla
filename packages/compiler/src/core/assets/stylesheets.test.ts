import { expect, it } from 'bun:test';
import { compileModulesDetailed, createProject, CompileError, type SourceLanguage } from '../../index';

interface Sheet { code: string; css: string; use?: string }

// A language unrelated to Auwla: this exercises only the generic source hook.
const language: SourceLanguage = {
  extensions: ['.view'],
  toTsx(text, path) {
    const sheet = JSON.parse(text) as Sheet;
    return {
      code: sheet.code, origin: { original: (offset) => offset },
      stylesheet: {
        dependencies: sheet.use === undefined ? [] : [sheet.use],
        render(resolve) {
          if (sheet.use === undefined) return sheet.css;
          const dependency = resolve(sheet.use, path);
          if (dependency === undefined) throw new CompileError('missing style source', path, 1, 1);
          return sheet.css + (JSON.parse(dependency.text) as Sheet).css;
        },
      },
    };
  },
};

const app = JSON.stringify({ code: 'export const value = 1;', css: 'p{}', use: '#theme' });
const definition = (css: string) => JSON.stringify({ code: 'not JavaScript: do not parse or emit this', css });

it('links source-only inputs without parsing or emitting their JavaScript', () => {
  const result = compileModulesDetailed({ './App.view': app }, {
    languages: [language], assetSources: { './styles/Theme.view': definition('a{}') },
    resolveImport: (specifier) => specifier === '#theme' ? './styles/Theme.view' : undefined,
  });
  expect(Object.keys(result.output)).toEqual(['./App.view']);
  expect(result.css).toEqual({ './App.view.css': 'p{}a{}' });
});

it('collects, caches, watches and prunes style sources independently from JS imports', async () => {
  const files: Record<string, string> = { './App.view': app, './styles/Theme.view': definition('a{}') };
  const reads = new Map<string, number>();
  const project = createProject({
    entries: ['./App.view'], languages: [language],
    host: {
      readFile(path) { reads.set(path, (reads.get(path) ?? 0) + 1); return files[path]; },
      async resolve(specifier) { return specifier === '#theme' ? './styles/Theme.view' : undefined; },
    },
  });
  const build = await project.build();
  expect(build.ok).toBe(true);
  if (!build.ok) throw build.error;
  expect(build.modules).toEqual(['./App.view', './styles/Theme.view']);
  expect(Object.keys(build.output)).toEqual(['./App.view']);
  await project.build();
  expect(reads.get('./styles/Theme.view')).toBe(1);
  const rootReads = reads.get('./App.view');

  files['./styles/Theme.view'] = definition('a{color:teal}');
  const updated = await project.update(['./styles/Theme.view']);
  expect(updated.changed).toEqual(['./App.view.css']);
  expect(reads.get('./App.view')).toBe(rootReads);

  delete files['./styles/Theme.view'];
  const missing = await project.update(['./styles/Theme.view']);
  expect(missing.build.ok).toBe(false);
  files['./styles/Theme.view'] = definition('a{color:navy}');
  expect((await project.update(['./styles/Theme.view'])).build.ok).toBe(true);

  files['./App.view'] = JSON.stringify({ code: 'export const value = 1;', css: 'p{}' });
  const removed = await project.update(['./App.view']);
  expect(removed.build.modules).toEqual(['./App.view']);
  expect(removed.build.ok && removed.build.output['./App.view']).toBe(build.output['./App.view']);
});

it('retains class-host resolver context and can read supplied source-only inputs', async () => {
  class Host {
    #target = './styles/Theme.view';
    readFile(path: string) { return path === './App.view' ? app : undefined; }
    async resolve(specifier: string) { return specifier === '#theme' ? this.#target : undefined; }
  }
  const assetSources = { './styles/Theme.view': definition('a{color:teal}') };
  const project = createProject({ entries: ['./App.view'], languages: [language], host: new Host(), assetSources });
  const build = await project.build();
  expect(build.ok && build.css).toEqual({ './App.view.css': 'p{}a{color:teal}' });
  assetSources['./styles/Theme.view'] = definition('a{color:navy}');
  const changed = await project.update(['./styles/Theme.view']);
  expect(changed.changed).toEqual(['./App.view.css']);
});
