import {
  compileModulesDetailed,
  experimentalCompilePackage,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';

interface Measurement {
  readonly helpers: number;
  readonly modules: number;
  readonly sourceBytes: number;
  readonly artifactBytes: number;
  readonly artifactGenerationMs: number;
  readonly linkedSourceMs: number;
  readonly artifactLinkMs: number;
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

function packageSources(helpers: number): Record<string, string> {
  const modules: Record<string, string> = {};
  const imports: string[] = [];
  const exports: string[] = [];
  for (let index = 0; index < helpers; index++) {
    const local = `helper${index}`;
    modules[`./package/${local}.ts`] = `
      import { $track } from '@memoized-dom/data';
      export function ${local}(source) {
        return $track(source).pending ? 'pending-${index}' : source.length;
      }
    `;
    imports.push(`import { ${local} as read${index} } from './${local}';`);
    exports.push(`export function ${local}(source) { return read${index}(source); }`);
  }
  modules['./package/index.ts'] = `${imports.join('\n')}\n${exports.join('\n')}`;
  return modules;
}

function applicationSource(helpers: number): Record<string, string> {
  const used = Math.min(helpers, 8);
  const imports = Array.from({ length: used }, (_, index) => `helper${index}`).join(', ');
  const reads = Array.from(
    { length: used },
    (_, index) => `helper${index}(stories)`,
  ).join(" + ':' + ");
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

function generateArtifact(
  sources: Readonly<Record<string, string>>,
): ExperimentalPackageArtifact {
  return experimentalCompilePackage(sources, {
    packageEntries: { 'bench-package': './package/index.ts' },
  }).artifact;
}

function measure(helpers: number): Measurement {
  const packageModules = packageSources(helpers);
  const application = applicationSource(helpers);
  let artifact!: ExperimentalPackageArtifact;
  const artifactGenerationMs = elapsed(() => {
    artifact = generateArtifact(packageModules);
  });

  const linkedSource = (): void => {
    compileModulesDetailed({ ...packageModules, ...application }, {
      resolveImport(specifier) {
        return specifier === 'bench-package'
          ? './package/index.ts'
          : undefined;
      },
    });
  };
  const artifactLink = (): void => {
    compileModulesDetailed(application, {
      experimentalPackageArtifacts: [artifact],
    });
  };

  linkedSource();
  artifactLink();
  const linkedSourceSamples: number[] = [];
  const artifactLinkSamples: number[] = [];
  for (let iteration = 0; iteration < 7; iteration++) {
    if ((iteration & 1) === 0) {
      linkedSourceSamples.push(elapsed(linkedSource));
      artifactLinkSamples.push(elapsed(artifactLink));
    } else {
      artifactLinkSamples.push(elapsed(artifactLink));
      linkedSourceSamples.push(elapsed(linkedSource));
    }
  }

  return {
    helpers,
    modules: Object.keys(packageModules).length,
    sourceBytes: Object.values(packageModules).reduce(
      (total, source) => total + Buffer.byteLength(source),
      0,
    ),
    artifactBytes: Buffer.byteLength(JSON.stringify(artifact)),
    artifactGenerationMs,
    linkedSourceMs: median(linkedSourceSamples),
    artifactLinkMs: median(artifactLinkSamples),
  };
}

const rows = [8, 32, 64].map(measure);

console.log('\nPACKAGE SEMANTIC ARTIFACTS (Bun, median of 7 warm links)\n');
console.log(
  'helpers'.padStart(8),
  'modules'.padStart(8),
  'source'.padStart(10),
  'artifact'.padStart(10),
  'generate'.padStart(11),
  'with source'.padStart(13),
  'artifact link'.padStart(14),
  'ratio'.padStart(8),
);
console.log('-'.repeat(92));
for (const row of rows) {
  console.log(
    String(row.helpers).padStart(8),
    String(row.modules).padStart(8),
    `${(row.sourceBytes / 1024).toFixed(1)}KiB`.padStart(10),
    `${(row.artifactBytes / 1024).toFixed(1)}KiB`.padStart(10),
    `${row.artifactGenerationMs.toFixed(1)}ms`.padStart(11),
    `${row.linkedSourceMs.toFixed(1)}ms`.padStart(13),
    `${row.artifactLinkMs.toFixed(1)}ms`.padStart(14),
    `${(row.linkedSourceMs / row.artifactLinkMs).toFixed(2)}x`.padStart(8),
  );
}

console.log('\nGeneration is cold and package-owned; link columns are warm medians.');
