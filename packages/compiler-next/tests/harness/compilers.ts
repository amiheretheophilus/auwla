/**
 * The compilers a case can run against: `COMPILER=next` (the default) uses
 * `packages/compiler-next/src`; `COMPILER=old` uses `packages/compiler`. Both
 * emit code for the same runtime, so they mount the same way. Each writes its
 * output to its own folder, `tests/out/<case>/<output>/`.
 */
import { compileModules } from '@memoized-dom/compiler';
import { compileModules as compileModulesNext } from '../../src';
import { createApplicationRuntime, registeredIds, resetScheduler, setActiveApplicationRuntime, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';
import { adoptRoot } from '@memoized-dom/runtime/hydrate-program';
import { renderToString } from '@memoized-dom/server';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { installedResolver } from './installed';
import { fetchForCase } from './requests';
import { asServer, asServerAsync } from './case';

export interface CompiledApp {
  /** Remove the app and everything the runtime registered for it. */
  unmount(): void;
}

export interface Compiler {
  name: string;
  /** The folder under `tests/out/<case>/` that holds this compiler's output. */
  output: string;
  prepare(): () => void;
  /** Compile `App.tsx`. Returns the output files by name. */
  compile(source: string, modules?: Record<string, string>, timeoutMs?: number): Record<string, string>;
  /** Mount the compiled `App` into `container`; `served` is a second copy a server renders from. */
  mount(module: Record<string, unknown>, container: HTMLElement, served?: Record<string, unknown>): CompiledApp;
  /** Whether `mount` takes a server render, which needs its own copy of the modules. */
  readonly serves?: boolean;
}

const oldCompiler: Compiler = {
  name: 'packages/compiler',
  output: 'old',

  prepare() {
    const runtime = createDataRuntime({ fetch: fetchForCase });
    const previous = setActiveDataRuntime(runtime);
    return () => {
      runtime.clear();
      setActiveDataRuntime(previous);
    };
  },

  compile(source, modules, timeoutMs) {
    const timeout = Number(process.env.COMPILER_TIMEOUT_MS ?? timeoutMs ?? 0);
    if (!Number.isFinite(timeout) || timeout < 0) throw new Error('COMPILER_TIMEOUT_MS must be a non-negative number');
    if (timeout > 0) {
      // A synchronous compiler loop prevents Bun's test timer from firing.
      // Isolate suspect cases so the OS can enforce the diagnostic deadline.
      const result = spawnSync(process.execPath, [join(import.meta.dirname, 'compile-worker.ts')], {
        input: JSON.stringify({ ...modules, './App.tsx': source }),
        encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      });
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
        throw new Error(`old compiler: compilation exceeded ${timeout}ms in an isolated process`);
      }
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const diagnostic = result.stderr.split('\n').filter(line => line.length < 1000).join('\n').trim();
        throw new Error(diagnostic || `old compiler: isolated process exited with ${result.status ?? result.signal}`);
      }
      return JSON.parse(result.stdout) as Record<string, string>;
    }
    return compileModules({ ...modules, './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing' });
  },

  mount(module, container) {
    const App = module.App as (id: string, parent: null) => Node;
    // Updates run synchronously, so the DOM is current as soon as a step settles.
    setScheduler((run) => run());
    container.append(App('App', null));
    return {
      unmount() {
        clearCompiledApps();
        container.replaceChildren();
      },
    };
  },
};

/** `DATA_DELIVERY=client` runs the cases as a client-only build compiles them. */
const delivery = process.env.DATA_DELIVERY === 'client' ? { dataDelivery: 'client' as const } : {};

/** Only the app's entry is used from outside, as in a real build. `ENTRIES=all` assumes every export is. */
const entries = process.env.ENTRIES === 'all' ? {} : { entries: ['./App.tsx'] };

/** Compile a case with compiler-next, seeing into any package the case installs. */
function compileNext(source: string, modules: Record<string, string> | undefined, optimize: boolean): Record<string, string> {
  const files = { ...modules, './App.tsx': source };

  return compileModulesNext(files, {
    runtimePath: '@memoized-dom/runtime/testing',
    resolveImport: installedResolver(Object.keys(files)),
    ...(optimize ? {} : { optimize: false }),
    ...delivery,
    ...entries,
  });
}

const nextCompiler: Compiler = {
  ...oldCompiler,
  name: 'packages/compiler-next',
  output: 'next',

  compile(source, modules) {
    return compileNext(source, modules, true);
  },
};

const generalCompiler: Compiler = {
  ...nextCompiler,
  name: 'packages/compiler-next (optimizations disabled)',
  output: 'next-general',

  compile(source, modules) {
    return compileNext(source, modules, false);
  },
};

/** A fetch for the server's side, which never answers: the browser's requests are the case's. */
const neverAnswers = (() => new Promise(() => {})) as unknown as typeof fetch;

/**
 * Loads the server's copy of the modules as a server would: module effects do not run, and module
 * sources and `defer` belong to a data runtime no step reaches.
 */
export async function importAsServer<T>(load: () => Promise<T>): Promise<T> {
  const application = createApplicationRuntime('delivered-server', { effects: 'disabled', refs: 'disabled', schedule: null });
  const data = createDataRuntime({ fetch: neverAnswers });
  // A module's top level runs when the import settles, outside any synchronous scope, so the
  // active runtimes are swapped around it. Cases run one at a time.
  const previousApplication = setActiveApplicationRuntime(application);
  const previousData = setActiveDataRuntime(data);
  try {
    return await asServerAsync(load);
  } finally {
    setActiveApplicationRuntime(previousApplication);
    setActiveDataRuntime(previousData);
  }
}

/**
 * The page as delivered (`wiki/compiler/delivery.md`, "How it is tested"): the server's HTML first,
 * then the client render adopting its nodes. A program the server cannot run is mounted fresh, as
 * a browser would show it.
 */
const deliveredCompiler: Compiler = {
  ...nextCompiler,
  name: 'packages/compiler-next (adopting server HTML)',
  output: 'next-delivered',
  serves: true,

  mount(module, container, served) {
    const App = module.App as (id: string, parent: null) => Node;
    setScheduler((run) => run());
    let html: string | null = null;
    try {
      // Requests a server makes are its own, and never answered here.
      html = asServer(() => renderToString(served!.App as never, { markers: true, fetch: neverAnswers }));
    } catch {
      html = null;
    }
    if (html === null) {
      container.append(App('App', null));
    } else {
      container.innerHTML = html;
      adoptRoot(container.firstChild!, container.lastChild!, () => container.append(App('App', null)));
    }
    return {
      unmount() {
        clearCompiledApps();
        container.replaceChildren();
      },
    };
  },
};

/**
 * Every next comparison also exercises the independently emitted general path, and the page as
 * delivered (`DELIVERED=0` leaves that out).
 */
export function comparisonCompilers(): readonly Compiler[] {
  const compiler = selectedCompiler();
  if (compiler !== nextCompiler) return [compiler];
  return process.env.DELIVERED === '0' ? [nextCompiler, generalCompiler] : [nextCompiler, generalCompiler, deliveredCompiler];
}

/** Also used after a failed mount, which cannot return its unmount callback. */
export function clearCompiledApps(): void {
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();
}

export function selectedCompiler(): Compiler {
  const choice = process.env.COMPILER ?? 'next';
  if (choice === 'old') return oldCompiler;
  if (choice === 'next') return nextCompiler;
  throw new Error(`COMPILER=${choice}: use 'old' or 'next'`);
}
