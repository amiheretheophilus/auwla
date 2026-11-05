/**
 * What an app pays for a native package. compiler-next compiles the package's source in the
 * app's graph (`wiki/compiler/linking.md`, "Native packages"). The old compiler's linked
 * source and its semantic artifact are shown beside it, as what that choice replaced.
 */
import {
  compileModulesDetailed,
  experimentalCompilePackage,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import { compileModules as compileNext } from '../../packages/compiler-next/src';

interface Measurement {
  readonly helpers: number;
  readonly modules: number;
  readonly sourceBytes: number;
  readonly appAloneMs: number;
  readonly inGraphMs: number;
  readonly oldSourceMs: number;
  readonly oldArtifactMs: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function elapsed(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

/** Status helpers behind a barrel, which an app reaches only through the package's name. */
function packageSources(helpers: number): Record<string, string> {
  const modules: Record<string, string> = {};
  const imports: string[] = [];
  const exports: string[] = [];

  for (let index = 0; index < helpers; index++) {
    const local = `helper${index}`;
    modules[`./node_modules/bench-package/${local}.ts`] = `
      import { $track } from '@memoized-dom/data';
      export function ${local}(source) {
        return $track(source).pending ? 'pending-${index}' : source.length;
      }
    `;
    imports.push(`import { ${local} as read${index} } from './${local}';`);
    exports.push(`export function ${local}(source) { return read${index}(source); }`);
  }

  modules['./node_modules/bench-package/index.ts'] = `${imports.join('\n')}\n${exports.join('\n')}`;
  return modules;
}

function applicationSource(helpers: number): Record<string, string> {
  const used = Math.min(helpers, 8);
  const imports = Array.from({ length: used }, (_, index) => `helper${index}`).join(', ');
  const reads = Array.from({ length: used }, (_, index) => `helper${index}(stories)`).join(" + ':' + ");

  return {
    './app.tsx': `
      import { ${imports} } from 'bench-package';
      export function App() {
        const stories = $fetch('/stories');
        return <p>{${reads}}</p>;
      }
    `,
  };
}

const resolvePackage = (specifier: string): string | undefined => {
  return specifier === 'bench-package' ? './node_modules/bench-package/index.ts' : undefined;
};

/** A fast compile that left the package out of the graph proves nothing. */
function checkInGraph(packageModules: Record<string, string>, output: Record<string, string>): void {
  for (const path of Object.keys(packageModules)) {
    if (output[path] === undefined) {
      throw new Error(`compiler-next produced no output for ${path}`);
    }
  }

  // Each helper reads its source's status, so it must keep the source itself, not its payload.
  if (!output['./node_modules/bench-package/helper0.ts']?.includes('@memoized-dom/data')) {
    throw new Error('the package did not compile as part of the graph');
  }
}

function measure(helpers: number): Measurement {
  const packageModules = packageSources(helpers);
  const application = applicationSource(helpers);
  const everything = { ...packageModules, ...application };
  const artifact: ExperimentalPackageArtifact = experimentalCompilePackage(packageModules, {
    packageEntries: { 'bench-package': './node_modules/bench-package/index.ts' },
  }).artifact;

  const operations: readonly (() => void)[] = [
    () => { compileNext(application, {}); },
    () => { compileNext(everything, { resolveImport: resolvePackage, entries: ['./app.tsx'] }); },
    () => { compileModulesDetailed(everything, { resolveImport: resolvePackage }); },
    () => { compileModulesDetailed(application, { experimentalPackageArtifacts: [artifact] }); },
  ];

  checkInGraph(packageModules, compileNext(everything, { resolveImport: resolvePackage, entries: ['./app.tsx'] }));

  for (const operation of operations) {
    operation();
  }

  const samples: number[][] = operations.map(() => []);

  for (let iteration = 0; iteration < 7; iteration++) {
    // Rotate the order to reduce systematic temperature/JIT bias.
    for (let step = 0; step < operations.length; step++) {
      const index = (iteration + step) % operations.length;
      samples[index]!.push(elapsed(operations[index]!));
    }
  }

  return {
    helpers,
    modules: Object.keys(packageModules).length,
    sourceBytes: Object.values(packageModules).reduce((total, source) => total + Buffer.byteLength(source), 0),
    appAloneMs: median(samples[0]!),
    inGraphMs: median(samples[1]!),
    oldSourceMs: median(samples[2]!),
    oldArtifactMs: median(samples[3]!),
  };
}

const rows = [8, 32, 64].map(measure);

console.log('\nNATIVE PACKAGE IN THE APP\'S GRAPH (Bun, median of 7 warm compiles)\n');
console.log(
  'helpers'.padStart(8),
  'modules'.padStart(8),
  'source'.padStart(10),
  'app alone'.padStart(11),
  'in graph'.padStart(11),
  'added'.padStart(10),
  'added/mod'.padStart(11),
  'old source'.padStart(12),
  'old artifact'.padStart(14),
);
console.log('-'.repeat(104));

for (const row of rows) {
  const added = row.inGraphMs - row.appAloneMs;

  console.log(
    String(row.helpers).padStart(8),
    String(row.modules).padStart(8),
    `${(row.sourceBytes / 1024).toFixed(1)}KiB`.padStart(10),
    `${row.appAloneMs.toFixed(1)}ms`.padStart(11),
    `${row.inGraphMs.toFixed(1)}ms`.padStart(11),
    `${added.toFixed(1)}ms`.padStart(10),
    `${(added / row.modules).toFixed(2)}ms`.padStart(11),
    `${row.oldSourceMs.toFixed(1)}ms`.padStart(12),
    `${row.oldArtifactMs.toFixed(1)}ms`.padStart(14),
  );
}

console.log('\n"added" is what the package costs the app. Every package file checked to be in the graph.');
