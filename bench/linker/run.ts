/**
 * What linking a graph costs as it grows: the same source graph, compiled whole, with the old
 * compiler and with compiler-next. See `README.md`.
 */
import { compileModules as compileOld } from '@memoized-dom/compiler';
import { compileModules as compileNext } from '../../packages/compiler-next/src';

interface Row {
  modules: number;
  bytes: number;
  oldMs: number;
  newMs: number;
}

/** One state module and one importing view for each pair, reached through a `@` alias. */
function graph(pairs: number): Record<string, string> {
  const modules: Record<string, string> = {};

  for (let i = 0; i < pairs; i++) {
    modules[`./src/state-${i}.ts`] = `
      export let value = ${i};
      export const doubled = value * 2;
      export function bump() { value++; }
    `;
    modules[`./src/view-${i}.tsx`] = `
      import { value, doubled, bump } from '@/state-${i}';
      export function View${i}() {
        return <button onClick={() => bump()}>{value}:{doubled}</button>;
      }
    `;
  }

  return modules;
}

function linkOld(modules: Record<string, string>): Record<string, string> {
  return compileOld(modules, { aliases: { '@': './src' } });
}

function linkNext(modules: Record<string, string>): Record<string, string> {
  return compileNext(modules, {
    resolveImport: (specifier) => specifier.startsWith('@/') ? `./src/${specifier.slice(2)}.ts` : undefined,
  });
}

/** A fast compiler that links wrongly proves nothing: each view must read its own state. */
function checkLinked(modules: Record<string, string>, output: Record<string, string>): void {
  for (const path of Object.keys(modules)) {
    if (output[path] === undefined) {
      throw new Error(`compiler-next produced no output for ${path}`);
    }

    const view = /view-(\d+)\.tsx$/.exec(path);

    if (view !== null && !output[path].includes(`./state-${view[1]}`)) {
      throw new Error(`${path} does not read the state of ./state-${view[1]}`);
    }
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

function measure(modules: Record<string, string>): Row {
  const runOld = () => {
    linkOld(modules);
  };
  const runNew = () => {
    linkNext(modules);
  };

  checkLinked(modules, linkNext(modules));
  runOld();

  const oldSamples: number[] = [];
  const newSamples: number[] = [];

  for (let i = 0; i < 7; i++) {
    // Alternate order to reduce systematic temperature/JIT bias.
    if ((i & 1) === 0) {
      oldSamples.push(time(runOld));
      newSamples.push(time(runNew));
    } else {
      newSamples.push(time(runNew));
      oldSamples.push(time(runOld));
    }
  }

  return {
    modules: Object.keys(modules).length,
    bytes: Object.values(modules).reduce((sum, source) => sum + source.length, 0),
    oldMs: median(oldSamples),
    newMs: median(newSamples),
  };
}

const rows = [1, 4, 8, 32, 128].map((pairs) => measure(graph(pairs)));

console.log('\nCROSS-MODULE LINKER (Bun, median of 7)\n');
console.log(
  'modules'.padStart(8),
  'source'.padStart(10),
  'old'.padStart(12),
  'new'.padStart(12),
  'new/module'.padStart(12),
  'new/old'.padStart(10),
);
console.log('-'.repeat(68));

for (const row of rows) {
  console.log(
    String(row.modules).padStart(8),
    `${(row.bytes / 1024).toFixed(1)}KiB`.padStart(10),
    `${row.oldMs.toFixed(1)}ms`.padStart(12),
    `${row.newMs.toFixed(1)}ms`.padStart(12),
    `${(row.newMs / row.modules).toFixed(2)}ms`.padStart(12),
    `${(row.newMs / row.oldMs).toFixed(2)}x`.padStart(10),
  );
}

console.log('\nEvery view checked to read its own state module (compiler-next).');
