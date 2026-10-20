import { describe, expect, it } from 'bun:test';
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
