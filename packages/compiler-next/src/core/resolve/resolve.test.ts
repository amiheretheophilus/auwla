import { describe, expect, it } from 'bun:test';
import { parseModule } from '../parse';
import { resolve, type ResolvedModule } from '.';

function resolveModules(modules: Record<string, string>): ResolvedModule[] {
  const parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  return [...resolve(parsed, {}).modules];
}

/** The write sites of the (first) binding called `name`, in a readable form. */
function writesOf(source: string, name: string) {
  const [module] = resolveModules({ './m.tsx': source });
  const binding = module!.module.bindings.find((candidate) => candidate.name === name);
  if (binding === undefined) throw new Error(`no binding ${name}`);
  return (module!.writes.get(binding) ?? []).map((site) => ({
    kind: site.kind,
    path: site.path,
    ...(site.method === undefined ? {} : { method: site.method }),
    timing: site.timing,
  }));
}

describe('write sites', () => {
  it('reassignment in the body is a body write; in a handler, a later one', () => {
    const source = `
      function App() {
        let count = 0;
        if (count < 0) count = 0;
        const click = () => count++;
      }`;
    expect(writesOf(source, 'count')).toEqual([
      { kind: 'assign', path: [], timing: 'body' },
      { kind: 'update', path: [], timing: 'later' },
    ]);
  });

  it('finds mutation through members, methods, delete and arguments', () => {
    const source = `
      let user = { address: { city: 'a' }, tags: [] };
      user.address.city = 'b';
      user.tags.push('x');
      delete user.address;
      save(user.tags);
      user[key] = 1;
      (user as any).name = 'c';`;
    expect(writesOf(source, 'user')).toEqual([
      { kind: 'member', path: ['address', 'city'], timing: 'body' },
      { kind: 'call', path: ['tags'], method: 'push', timing: 'body' },
      { kind: 'delete', path: ['address'], timing: 'body' },
      { kind: 'argument', path: ['tags'], timing: 'body' },
      { kind: 'member', path: [null], timing: 'body' },
      { kind: 'member', path: ['name'], timing: 'body' },
    ]);
  });

  it('reads are not writes', () => {
    expect(writesOf('let items = [1]; const n = items.length + items[0];', 'items')).toEqual([]);
  });

  it('does not turn RHS members, pattern keys/defaults or loop sources into store targets', () => {
    const source = `let item = {}, result;
      result = item.value;
      ({ [item.key]: result = item.fallback } = input);
      for (result of item.values) {}
      item.count = result;`;
    expect(writesOf(source, 'item')).toEqual([
      { kind: 'member', path: ['count'], timing: 'body' },
    ]);
  });

  it('module state written in a function is a later write', () => {
    expect(writesOf('export let todos = []; export function add(t) { todos.push(t); }', 'todos')).toEqual([
      { kind: 'call', path: [], method: 'push', timing: 'later' },
    ]);
  });

  it('state in a factory closure is written later, through the returned method', () => {
    const source = 'function createStore() { let n = 0; return { inc() { n++; } }; }';
    expect(writesOf(source, 'n')).toEqual([{ kind: 'update', path: [], timing: 'later' }]);
  });

  it('class fields: a method write is later; a static block runs with the class', () => {
    const source = `
      let created = 0;
      class Counter {
        static { created++; }
        value = created++;
        inc() { this.value++; created = 0; }
      }`;
    expect(writesOf(source, 'created')).toEqual([
      { kind: 'update', path: [], timing: 'body' },
      { kind: 'update', path: [], timing: 'later' },
      { kind: 'assign', path: [], timing: 'later' },
    ]);
  });

  it('a parameter written in its own body is a body write', () => {
    expect(writesOf('function f(label) { if (!label) label = "x"; }', 'label')).toEqual([
      { kind: 'assign', path: [], timing: 'body' },
    ]);
  });

  it('keeps full operations for nested patterns and loop assignment targets', () => {
    const [entry] = resolveModules({
      // `last = value` reads `value`; passing it to a call would add an `argument` site.
      './m.tsx': 'let value, last; ({ nested: [value = 1] } = input); for ([value] of pairs) last = value;',
    });
    const binding = entry!.module.bindings.find((candidate) => candidate.name === 'value')!;
    const writes = entry!.writes.get(binding)!;
    expect(writes.map((site) => site.node.type)).toEqual(['AssignmentExpression', 'ForOfStatement']);
  });
});

describe('global writes', () => {
  function globalsOf(source: string) {
    const parsed = [parseModule('./m.tsx', source)];
    return resolve(parsed, {}).globals;
  }

  it('records reassigned globals and properties written on a global', () => {
    const globals = globalsOf(`
      counter = counter + 1;
      document.title = 'x';
      window.flag = true;
      delete self.cache;`);
    expect([...globals.names].sort()).toEqual(['cache', 'counter', 'document', 'flag', 'self', 'window']);
    expect(globals.any).toBe(false);
  });

  it('does not count reads or host method calls as writes', () => {
    const globals = globalsOf(`
      const id = setInterval(() => {}, 10);
      console.log(Math.round(Math.random() * 10));
      localStorage.setItem('k', document.title);`);
    expect(globals.names.size).toBe(0);
    expect(globals.any).toBe(false);
  });

  it('a computed write through the global object may change any global', () => {
    expect(globalsOf('window[name] = 1;').any).toBe(true);
    expect(globalsOf('globalThis.ready = 1;').names.has('ready')).toBe(true);
  });

  it('a declared binding with a global name is not a global', () => {
    expect(globalsOf('let document = {}; document.title = 1;').names.size).toBe(0);
  });
});

describe('imports', () => {
  it('resolve across the compiled modules, with or without an extension', () => {
    const modules = resolveModules({
      './App.tsx': "import { name } from './data/session'; import { x } from 'some-package';",
      './data/session.ts': "export const name = 'Ada';",
    });
    const app = modules[0]!.module;
    expect(app.imports.map((entry) => entry.resolvedModule?.path ?? null)).toEqual(['./data/session.ts', null]);
    const definition = app.imports[0]!.local!.definition();
    expect(definition?.module.path).toBe('./data/session.ts');
  });

  it('resolve parent directories', () => {
    const modules = resolveModules({
      './pages/Home.tsx': "import { name } from '../store';",
      './store/index.ts': 'export let name = 1;',
    });
    expect(modules[0]!.module.imports[0]!.resolvedModule?.path).toBe('./store/index.ts');
  });
});
