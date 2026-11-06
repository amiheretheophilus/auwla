import { describe, expect, it } from 'bun:test';
import { generate } from 'yuku-codegen';
import { parse } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import { parseModule } from '.';

/** Runs lowered TypeScript as JavaScript and returns what `body` returns. */
function run(source: string, body: string): unknown {
  const { source: lowered } = parseModule('./module.ts', source);
  // Only parameter properties and enums are lowered; the rest of these snippets is plain JS.
  return new Function(`${lowered}\n${body}`)();
}

describe('parse', () => {
  it('chooses the language from the path and finds JSX', () => {
    expect(parseModule('./a.ts', 'let x: number = 1;').lang).toBe('ts');
    expect(parseModule('./a.tsx', 'const v = <p />;').hasJsx).toBe(true);
    expect(parseModule('./a.js', 'const v = 1;').hasJsx).toBe(false);
  });

  it('reports a syntax error with its line and column', () => {
    const parse = () => parseModule('./bad.ts', 'let a = 1;\nlet b = ;');
    expect(parse).toThrow(CompileError);
    expect(parse).toThrow('./bad.ts:2:9');
  });
});

describe('enum', () => {
  it('numbers members and maps values back to names, as tsc does', () => {
    const result = run('enum Mode { A, B = 5, C }', 'return [Mode.A, Mode.B, Mode.C, Mode[5]];');
    expect(result).toEqual([0, 5, 6, 'B']);
  });

  it('keeps string members without a reverse mapping', () => {
    const result = run("enum Tone { Loud = 'loud', Soft = `soft` }", 'return [Tone.Loud, Tone.Soft, Tone.loud];');
    expect(result).toEqual(['loud', 'soft', undefined]);
  });

  it('lets an initializer name earlier members', () => {
    const result = run('enum Flag { A = 1, B = 2, AB = A | B }', 'return Flag.AB;');
    expect(result).toBe(3);
  });

  it('lowers const enums and exported enums, and removes declared ones', () => {
    expect(run('const enum Size { S, M }', 'return Size.M;')).toBe(1);
    const lowered = parseModule('./m.ts', 'export enum E { A }\nexport declare enum D { X }').source;
    expect(lowered).toContain('export var E;');
    expect(lowered).not.toContain('D');
  });

  it('keeps offsets right after non-ASCII text', () => {
    const result = run('const s = "héllo 🎉";\nenum Mode { A, B }', 'return Mode.B;');
    expect(result).toBe(1);
  });
});

describe('namespace', () => {
  it('makes exported names properties, in every block that can see them', () => {
    const source = `
      namespace A { export let count = 1; const local = 2; export function read() { return count + local; } }
      namespace A { export const next = count + 1; export function bump() { count = count + 10; return next; } }`;
    expect(run(source, 'A.bump(); return [A.count, A.read(), A.next];')).toEqual([11, 13, 2]);
  });

  it('does not rewrite a name that means something else', () => {
    const source = `
      namespace A {
        export const x = 1;
        export function shadow(x) { return x; }
        export function hides(A) { return x; }
        const object = { x };
        export const short = object.x;
      }`;
    expect(run(source, 'return [A.shadow(9), A.hides(0), A.short];')).toEqual([9, 1, 1]);
  });

  it('assigns through patterns, and a variable without a value leaves no property', () => {
    const source = `
      namespace A {
        const from = { p: 1, q: 2, s: 4 };
        export const { p, q: renamed, ...rest }: any = from;
        export let a, b = 2, c;
        export const [d = 5, , e] = [undefined, 0, 6];
        export function read() { return [p, renamed, rest.s, b, d, e]; }
      }`;
    expect(run(source, "return [A.read(), 'a' in A, 'c' in A];")).toEqual([[1, 2, 4, 2, 5, 6], false, false]);
  });

  it('nests, and joins a dotted name with the blocks it merges with', () => {
    const source = `
      namespace A.B.C { export const x = 1; }
      namespace A { export namespace B { export const y = C.x + 1; } export const z = B.y; }`;
    expect(run(source, 'return [A.B.C.x, A.B.y, A.z];')).toEqual([1, 2, 2]);
  });

  it('keeps the object reachable when something inside has the same name', () => {
    const source = `
      namespace A { export namespace A { export const x = 1; export const y = x; } export const z = A.y; }
      namespace B.B { export const q = 1; }`;
    expect(run(source, 'return [A.A.x, A.z, B.B.q];')).toEqual([1, 1, 1]);
  });

  it('lets a class read itself before the namespace has it', () => {
    const source = 'namespace A { export class C { static self = C; } }';
    expect(run(source, 'return A.C.self === A.C;')).toBe(true);
  });

  it('merges with a class and a function without declaring them again', () => {
    const source = `
      class K { static made = 1; }
      namespace K { export const extra = K.made + 1; }
      function F() { return 3; }
      namespace F { export const k = 4; }`;
    expect(run(source, 'return [K.extra, F(), F.k];')).toEqual([2, 3, 4]);
  });

  it('lowers enums inside, with names from the namespace in their initializers', () => {
    const source = `
      namespace A {
        const base = 3;
        export const offset = 4;
        export enum E { X = base, Y = offset, Z }
        enum Local { M }
        export const m = Local.M + E.Z;
      }`;
    expect(run(source, 'return [A.E.X, A.E.Y, A.E.Z, A.m];')).toEqual([3, 4, 5, 5]);
  });

  it('merges exported enums and namespaces into one export', () => {
    const lowered = parseModule('./m.ts', 'export enum E { A }\nexport enum E { B = 1 }\nexport namespace E { export const c = 2; }').source;
    expect(lowered.match(/export var E/g)).toHaveLength(1);
    expect(new Function(`${lowered.replace('export var', 'var')}\nreturn [E.A, E.B, E.c];`)()).toEqual([0, 1, 2]);
  });

  it('survives statements without semicolons', () => {
    const source = `
      namespace A {
        const a = 1
        export const b = a
        export const {c} = {c: 2}
        export let d = 3
        export namespace In { export const e = d }
        export enum E { F }
      }`;
    expect(run(source, 'return [A.b, A.c, A.In.e, A.E.F];')).toEqual([1, 2, 3, 0]);
  });

  it('has no runtime part for types, overload signatures and declarations', () => {
    const lowered = parseModule('./m.ts', `
      namespace Types { export type X = 1; export interface Y {} }
      declare namespace Ambient { enum E { A } const z: number; }
      namespace A {
        export function f(a: string): void;
        export function f(a: any) { return a; }
        export declare const g: number;
        export type T = 1;
      }`).source;
    expect(lowered).toContain('declare namespace Types');
    expect(lowered).toContain('declare namespace Ambient');
    expect(lowered).toContain('enum E');
    const body = lowered.slice(lowered.indexOf('var A;'));
    expect(body).not.toContain('export');
    expect(body).not.toContain('f(a: string)');
  });

  it('refuses what has no meaning inside a namespace, as tsc does', () => {
    expect(() => parseModule('./m.ts', 'namespace A { const x = 1; export { x }; }')).toThrow('export declarations');
    expect(() => parseModule('./m.ts', 'namespace A { export default 1; }')).toThrow('no default export');
    expect(() => parseModule('./m.ts', "namespace A { import x = require('y'); export const k = x; }")).toThrow('require');
  });
});

describe('import aliases and export =', () => {
  it('copies an alias that is read as a value, and drops one that names a type', () => {
    const source = `
      namespace A.B { export const x = 1; export type T = 1; }
      namespace Types { export type T = 1; }
      import Value = A.B;
      import Type = A.B.T;
      import Erased = Types.T;
      let typed: Type;
      let erased: Erased;
      const copied = Value.x;
      namespace C { import Inner = A.B; export import Shared = A.B; export const k = Inner.x + Shared.x; }`;
    // Printing erases what is left: the annotations and the type-only namespace.
    const { code } = generate(parse(parseModule('./m.ts', source).source, { lang: 'ts', sourceType: 'module' }).program, { strip: true });
    expect(new Function(`${code}\nreturn [copied, C.k, C.Shared.x];`)()).toEqual([1, 2, 1]);
    expect(code).not.toContain('Type =');
    expect(code).not.toContain('Erased =');
  });

  it('exports an alias', () => {
    const lowered = parseModule('./m.ts', 'namespace A { export const x = 1; }\nexport import Y = A;').source;
    expect(lowered).toContain('export var Y = A;');
  });

  it('makes export = the default export', () => {
    const lowered = parseModule('./m.ts', 'const value = 1;\nexport = value;');
    expect(lowered.source).toContain('export default value;');
    expect(lowered.hasExportAssignment).toBe(true);
  });

  it('drops export = of a name with no value', () => {
    const lowered = parseModule('./m.ts', 'interface I {}\nexport = I;');
    expect(lowered.source).not.toContain('export default');
    expect(lowered.hasExportAssignment).toBe(false);
  });

  it('records where each require import is in the lowered text', () => {
    const lowered = parseModule('./m.ts', "enum E { A }\nimport a = require('./a');\nexport import b = require('./b');\nconst v = [a, b, E];");
    expect(lowered.requireImports.map((entry) => [entry.local, entry.specifier])).toEqual([['a', './a'], ['b', './b']]);
    for (const { at, local } of lowered.requireImports) {
      expect(lowered.source.startsWith(`import ${local} from`, at)).toBe(true);
    }
    expect(lowered.source).toContain('export { b };');
  });

  it('drops a require import nothing reads, as tsc does', () => {
    const lowered = parseModule('./m.ts', "import unused = require('./a');\nimport type T = require('./b');");
    expect(lowered.source).not.toContain('import');
    expect(lowered.requireImports).toEqual([]);
  });
});

describe('parameter properties', () => {
  it('assigns each to `this`, after `super(…)` when there is one', () => {
    const source = `
      class Base { constructor() { this.order = Object.keys(this).length; } }
      class Point extends Base {
        constructor(public x, private readonly y = 2) {
          super();
        }
      }`;
    const result = run(source, 'const p = new Point(1); return [p.x, p.y, p.order];');
    expect(result).toEqual([1, 2, 0]);
  });
});
