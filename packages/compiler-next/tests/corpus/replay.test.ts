/**
 * Replays programs recorded from the old compiler's tests against compiler-next and the reference
 * (`wiki/compiler/testing.md`, "Acceptance"). Those tests assert many things specific to the old
 * compiler. Their programs are still useful: each one is checked here by what a user would see.
 *
 *     MEMO_DOM_CORPUS=<dir> bun test ./tests/some-root-test.test.ts     # records programs
 *     CORPUS=<dir> CORPUS_REPORT=<file> bun test tests/corpus           # replays them
 *
 * Each program's outcome goes to the report, one line each, so one run shows everything.
 */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'bun:test';
import { observeBoth, runOnReference } from '../harness/run';
import type { Case, Step } from '../harness/case';

interface Recorded {
  readonly api: string;
  readonly args: readonly [unknown, Record<string, unknown>?];
}

const directory = process.env.CORPUS;
const report = process.env.CORPUS_REPORT;
const slice = process.env.CORPUS_SLICE?.split('/').map(Number);

/** One user action per element that listens, using its id when it has one. */
function stepsOf(sources: readonly string[]): Step[] {
  const steps: Step[] = [];
  const seen = new Set<string>();
  const add = (key: string, step: Step) => {
    if (seen.has(key) || steps.length >= 8) return;
    seen.add(key);
    steps.push(step);
  };

  for (const source of sources) {
    for (const match of source.matchAll(/<([a-z][a-z0-9]*)\b((?:[^<>"'{]|"[^"]*"|'[^']*'|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)>/g)) {
      const [, tag, attributes] = match;
      const id = /\bid=["']([\w-]+)["']/.exec(attributes!)?.[1];
      const selector = id === undefined ? tag! : `#${id}`;
      if (/\bon(Input|Change)=/.test(attributes!) && (tag === 'input' || tag === 'textarea')) {
        add(`input ${selector}`, { input: selector, value: 'typed' });
      }
      if (/\bonClick=/.test(attributes!)) add(`click ${selector}`, { click: selector });
    }
  }
  // Twice, because a second click is often where a stale value or a lost listener shows.
  return [...steps, ...steps];
}

/** A case for the program, or the reason it has no application to run. */
function caseOf(recorded: Recorded): Case | string {
  let modules: Record<string, string>;
  if (recorded.api === 'compile' || recorded.api === 'compileDetailed') {
    modules = { './App.tsx': recorded.args[0] as string };
  } else {
    modules = { ...(recorded.args[0] as Record<string, string>) };
  }

  if (Object.keys(modules).some((path) => /\.tsrx$/.test(path))) return 'tsrx';
  if (!Object.values(modules).some((source) => /<[a-zA-Z>]/.test(source))) return 'no markup';

  // An entry that mounts is the harness's job, and it names the root.
  let mounted: string | undefined;
  for (const [path, source] of Object.entries(modules)) {
    const call = /\bmount\s*\([^,]+,\s*([A-Z]\w*)/.exec(source);
    if (call !== null && !/<[a-zA-Z]/.test(source)) {
      mounted = call[1];
      delete modules[path];
    }
  }

  const name = mounted ?? 'App';
  const declares = (source: string, component: string) => new RegExp(`\\b(function|const|class)\\s+${component}\\b`).test(source);
  const paths = Object.keys(modules);
  let rootPath = paths.find((path) => declares(modules[path]!, name));
  let rootName = name;
  if (rootPath === undefined) {
    // The first exported component, then the first declared one: tests name their roots freely.
    for (const path of paths) {
      const found = /export\s+(?:default\s+)?function\s+([A-Z]\w*)/.exec(modules[path]!)
        ?? /\bfunction\s+([A-Z]\w*)/.exec(modules[path]!);
      if (found !== null) {
        rootPath = path;
        rootName = found[1]!;
        break;
      }
    }
  }
  if (rootPath === undefined) return 'no component';

  // A test compiling one module only to read its text need not have exported its root.
  let root = modules[rootPath]!;
  const exported = new RegExp(`export\\s+(default\\s+)?(async\\s+)?(function|const|class)\\s+${rootName}\\b|export\\s*\\{[^}]*\\b${rootName}\\b`);
  if (!exported.test(root)) root = root.replace(new RegExp(`\\b(function|const)\\s+${rootName}\\b`), `export $1 ${rootName}`);
  modules[rootPath] = root;

  // The harness runs `./App.tsx`, exporting `App`.
  const isDefault = new RegExp(`export\\s+default\\s+(async\\s+)?function\\s+${rootName}\\b`).test(root);
  const exportName = isDefault ? 'default' : rootName;
  let source: string;
  if (rootPath === './App.tsx' && rootName === 'App' && !isDefault) {
    source = root;
    delete modules[rootPath];
  } else if (rootPath === './App.tsx') {
    return 'root is a differently named ./App.tsx';
  } else {
    source = `export { ${exportName} as App } from ${JSON.stringify(rootPath.replace(/\.tsx?$/, '').replace(/^\/?(?!\.)/, './'))};`;
  }
  return { source, modules, steps: stepsOf([source, ...Object.values(modules)]) };
}

/** Tests set up globals for their programs to report through. Here they just have to exist. */
function provideGlobals(testCase: Case): void {
  const sources = [testCase.source, ...Object.values(testCase.modules ?? {})].join('\n');
  for (const [, name] of sources.matchAll(/globalThis\.(\w+)/g)) {
    if (name! in globalThis) continue;
    (globalThis as unknown as Record<string, unknown>)[name!] = Object.assign(() => undefined, { push: () => 0 });
  }
}

/**
 * Whether the reference can run the program, dropping steps on elements that never appear, since
 * they are only guessed from the source. Returns why not, when it cannot: such a program needs
 * something its original test gave it, such as props, so it compares nothing here.
 */
async function settleOnReference(name: string, testCase: Case): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const failure = await runOnReference(`${name}-${attempt}`, testCase).then(() => null, (error: Error) => String(error.message));
    if (failure === null) return null;
    const missing = /no element matches (\S+)/.exec(failure)?.[1];
    if (missing === undefined) return failure.replace(/\s+/g, ' ').slice(0, 200);
    testCase.steps = testCase.steps!.filter((step) => {
      return !('click' in step && step.click === missing) && !('input' in step && step.input === missing);
    });
  }
  return 'too many missing elements';
}

function record(line: string): void {
  if (report !== undefined) appendFileSync(report, `${line}\n`);
}

if (directory === undefined) {
  it.skip('needs CORPUS', () => {});
} else {
  if (report !== undefined) writeFileSync(report, '');
  let files = readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
  if (slice !== undefined) files = files.filter((_, index) => index % slice[1]! === slice[0]);

  for (const file of files) {
    const key = file.slice(0, 12);
    it(key, async () => {
      const recorded = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Recorded;
      const testCase = caseOf(recorded);
      if (typeof testCase === 'string') {
        record(`skip\t${key}\t${testCase}`);
        return;
      }

      // The clock and chance differ between any two runs, so there is nothing to compare.
      const everything = [testCase.source, ...Object.values(testCase.modules ?? {})].join('\n');
      if (/\b(Date\.now|new Date\(\)|Math\.random|performance\.now|setInterval|setTimeout)\b/.test(everything)) {
        record(`skip\t${key}\tclock or chance`);
        return;
      }

      provideGlobals(testCase);
      // Under its own name: a module imported again keeps its state, so a later run would not start fresh.
      const ready = await settleOnReference(`corpus-${key}-probe`, testCase);
      if (ready !== null) {
        record(`needs-setup\t${key}\t\t${ready}`);
        return;
      }

      let outcome = 'same';
      let detail = '';
      await observeBoth(`corpus-${key}`, testCase).then(({ reference, compiled }) => {
        expect(compiled).toEqual(reference);
      }).catch((error: Error) => {
        const message = String(error.message).replace(/\s+/g, ' ').slice(0, 260);
        outcome = /toEqual|Expected|expected/.test(message) ? 'differs'
          : /compiler-next|CompileError|memo-dom:/.test(message) ? 'compile-error'
            : 'threw';
        detail = message;
      });
      record(`${outcome}\t${key}\t${testCase.steps?.length ?? 0} steps\t${detail}`);
    }, 20_000);
  }
}
