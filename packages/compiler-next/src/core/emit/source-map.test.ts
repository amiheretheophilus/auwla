/**
 * Source maps point into the authored text, through every rewrite the compiler makes before
 * analysis. Read with an independent consumer (`@jridgewell/trace-mapping`).
 */
import { describe, expect, it } from 'bun:test';
import { TraceMap, eachMapping, originalPositionFor } from '@jridgewell/trace-mapping';
import { compileModulesDetailed } from '../../pipeline';

const NAME = /^[A-Za-z$][\w$]*/;

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1);
  return starts;
}

/**
 * Every name the output prints at a mapped position, and the name the map points at. A name the
 * compiler made (`_template`) starts with `_` and is skipped; so is a position whose authored text
 * is not a name (a mapped expression such as a call starts there).
 */
function mappedNames(modules: Record<string, string>, path: string, outputPath = path) {
  const compiled = compileModulesDetailed(modules, { sourceMaps: true });
  const output = compiled.output[outputPath]!;
  const map = compiled.maps![outputPath]!;
  expect(map.sources).toEqual([path]);
  const authored = modules[path]!;
  const outputLines = lineStarts(output);
  const authoredLines = lineStarts(authored);

  const pairs: Array<{ printed: string; authored: string }> = [];
  eachMapping(new TraceMap({ ...map, sources: [...map.sources], sourcesContent: [...map.sourcesContent], names: [] }), (mapping) => {
    if (mapping.originalLine === null) return;
    const printed = NAME.exec(output.slice(outputLines[mapping.generatedLine - 1]! + mapping.generatedColumn))?.[0];
    const original = NAME.exec(authored.slice(authoredLines[mapping.originalLine - 1]! + mapping.originalColumn))?.[0];
    if (printed === undefined || printed.startsWith('_') || original === undefined) return;
    pairs.push({ printed, authored: original });
  });
  return { pairs, compiled, map };
}

/**
 * Each of `names`, authored bindings the output keeps, is mapped somewhere, and wherever it is
 * mapped the map points at that name. Names the compiler writes (an `enum`'s lowering, a route
 * table's fields) map to where their rewrite was, so they are not listed.
 */
function expectNamesMapped(modules: Record<string, string>, path: string, names: readonly string[], outputPath = path) {
  const { pairs } = mappedNames(modules, path, outputPath);
  for (const name of names) {
    const mapped = pairs.filter((pair) => pair.printed === name);
    expect(mapped.length, name).toBeGreaterThan(0);
    for (const pair of mapped) expect(pair.authored).toBe(name);
  }
}

describe('source maps', () => {
  it('are given only when asked for', () => {
    const modules = { './App.tsx': 'export function App() { return <p>hi</p>; }' };
    expect(compileModulesDetailed(modules).maps).toBeUndefined();
    const map = compileModulesDetailed(modules, { sourceMaps: true }).maps!['./App.tsx']!;
    expect(map.sources).toEqual(['./App.tsx']);
    expect(map.sourcesContent).toEqual([modules['./App.tsx']]);
  });

  it('point at the authored names after TypeScript is lowered', () => {
    expectNamesMapped({
      './App.tsx': `interface Props { label: string; count: number }
enum Mode { Plain, Loud }
type Shout = (text: string) => string;
const shout: Shout = (text: string): string => text.toUpperCase();
export function App(props: Props) {
  let clicks: number = 0;
  const mode: Mode = props.count > 1 ? Mode.Loud : Mode.Plain;
  return <button onClick={() => clicks++}>{mode === Mode.Loud ? shout(props.label) : props.label}{clicks}</button>;
}
`,
    }, './App.tsx', ['shout', 'text', 'toUpperCase', 'props', 'clicks', 'mode', 'count', 'label']);
  });

  it('point at the authored names after slots and routes are lowered', () => {
    expectNamesMapped({
      './App.tsx': `function Card({ title }: { title: string }) {
  return <section><h2>{title}</h2><slot name="body">empty</slot></section>;
}
function Home() { const greeting = 'home'; return <Card title={greeting}><p slot="body">{greeting}</p></Card>; }
function About() { const about = 'about'; return <p>{about}</p>; }
export function App() {
  const heading = 'site';
  return <main><h1>{heading}</h1><Home route="/" /><About route="/about" /><a route-to="/about">About</a></main>;
}
`,
    }, './App.tsx', ['Card', 'title', 'greeting', 'about', 'heading']);
  });

  it('point at the authored names after an import-require is settled', () => {
    const modules = {
      './App.ts': `import values = require('./values');\nexport const total: number = values.first + values.second;\n`,
      './values.ts': 'export const first = 1;\nexport const second = 2;\n',
    };
    // The lowered `import * as values` is the compiler's text, written where the declaration was.
    expectNamesMapped(modules, './App.ts', ['total', 'first', 'second']);
  });

  it('give a companion module its own map, back to the authored module', () => {
    const modules = {
      './App.ts': `import values = require('./values');\nexport let total: number = values.first + 1;\nexport function add() { total++; }\n`,
      './values.ts': 'export let first = 1;\nexport function bump() { first++; }\n',
    };
    // Module state moves to `./App.mmd.ts`; its map's source is still `./App.ts`.
    expectNamesMapped(modules, './App.ts', ['total', 'first'], './App.mmd.ts');
  });

  it('leave code the compiler wrote unmapped rather than on the first line', () => {
    const { compiled, map } = mappedNames({ './App.tsx': `\n\nexport function App() { return <p>{1 + 1}</p>; }` }, './App.tsx');
    const output = compiled.output['./App.tsx']!;
    const outputLines = lineStarts(output);
    const trace = new TraceMap({ ...map, sources: [...map.sources], sourcesContent: [...map.sourcesContent], names: [] });
    // The runtime import is the compiler's: nothing authored is on line 1 at all.
    const runtimeLine = output.split('\n').findIndex((line) => line.includes('@memoized-dom/runtime')) + 1;
    expect(originalPositionFor(trace, { line: runtimeLine, column: 0 }).line).toBeNull();
    expect(outputLines.length).toBeGreaterThan(1);
  });
});
