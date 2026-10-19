/**
 * The compilers a case can run against. `COMPILER=old` (the default until
 * compiler-next produces output) uses `packages/compiler`.
 */
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, resetScheduler, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fetchForCase } from './requests';

export interface CompiledApp {
  /** Remove the app and everything the runtime registered for it. */
  unmount(): void;
}

export interface Compiler {
  name: string;
  prepare(): () => void;
  /** Compile `App.tsx`. Returns the output files by name. */
  compile(source: string, modules?: Record<string, string>, timeoutMs?: number): Record<string, string>;
  /** Mount the compiled `App` into `container`. */
  mount(module: Record<string, unknown>, container: HTMLElement): CompiledApp;
}

const oldCompiler: Compiler = {
  name: 'packages/compiler',

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

/** Also used after a failed mount, which cannot return its unmount callback. */
export function clearCompiledApps(): void {
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();
}

export function selectedCompiler(): Compiler {
  const choice = process.env.COMPILER ?? 'old';
  if (choice === 'old') return oldCompiler;
  throw new Error(`COMPILER=${choice}: compiler-next does not produce output yet`);
}
