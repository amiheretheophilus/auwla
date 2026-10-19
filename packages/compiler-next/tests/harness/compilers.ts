/**
 * The compilers a case can run against. `COMPILER=old` (the default until
 * compiler-next produces output) uses `packages/compiler`.
 */
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, resetScheduler, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';

export interface CompiledApp {
  /** Remove the app and everything the runtime registered for it. */
  unmount(): void;
}

export interface Compiler {
  name: string;
  /** Compile `App.tsx`. Returns the output files by name. */
  compile(source: string): Record<string, string>;
  /** Mount the compiled `App` into `container`. */
  mount(module: Record<string, unknown>, container: HTMLElement): CompiledApp;
}

const oldCompiler: Compiler = {
  name: 'packages/compiler',

  compile(source) {
    return compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing' });
  },

  mount(module, container) {
    const App = module.App as (id: string, parent: null) => Node;
    // Updates run synchronously, so the DOM is current as soon as a step settles.
    setScheduler((run) => run());
    container.append(App('App', null));
    return {
      unmount() {
        for (const id of registeredIds()) unregisterSubtree(id);
        resetScheduler();
        container.replaceChildren();
      },
    };
  },
};

export function selectedCompiler(): Compiler {
  const choice = process.env.COMPILER ?? 'old';
  if (choice === 'old') return oldCompiler;
  throw new Error(`COMPILER=${choice}: compiler-next does not produce output yet`);
}
