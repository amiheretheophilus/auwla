/**
 * What linking a graph costs as it grows: the same source graph, compiled whole by the compiler.
 * See `README.md`, which keeps the last comparison with the old compiler.
 */
import { compileModules } from '@memoized-dom/compiler-next';

interface Row {
  modules: number;
  bytes: number;
  ms: number;
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

function link(modules: Record<string, string>): Record<string, string> {
  return compileModules(modules, {
    resolveImport: (specifier) => specifier.startsWith('@/') ? `./src/${specifier.slice(2)}.ts` : undefined,
  });
}

/** A fast compiler that links wrongly proves nothing: each view must read its own state. */
function checkLinked(modules: Record<string, string>, output: Record<string, string>): void {
  for (const path of Object.keys(modules)) {
    if (output[path] === undefined) {
      throw new Error(`the compiler produced no output for ${path}`);
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
  // The check also warms the compiler up for this graph's size.
  checkLinked(modules, link(modules));

  const samples: number[] = [];
  for (let i = 0; i < 7; i++) {
    samples.push(time(() => link(modules)));
  }

  return {
    modules: Object.keys(modules).length,
    bytes: Object.values(modules).reduce((sum, source) => sum + source.length, 0),
    ms: median(samples),
  };
}

const rows = [1, 4, 8, 32, 128].map((pairs) => measure(graph(pairs)));

console.log('\nCROSS-MODULE LINKER (Bun, median of 7)\n');
console.log(
  'modules'.padStart(8),
  'source'.padStart(10),
  'time'.padStart(12),
  'per module'.padStart(12),
);
console.log('-'.repeat(45));

for (const row of rows) {
  console.log(
    String(row.modules).padStart(8),
    `${(row.bytes / 1024).toFixed(1)}KiB`.padStart(10),
    `${row.ms.toFixed(1)}ms`.padStart(12),
    `${(row.ms / row.modules).toFixed(2)}ms`.padStart(12),
  );
}

console.log('\nEvery view checked to read its own state module.');
