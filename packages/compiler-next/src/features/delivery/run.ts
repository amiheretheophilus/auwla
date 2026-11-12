/**
 * Runs a compiled application at build time, in a closed world, and reads the HTML it renders
 * (`wiki/compiler/delivery.md`). This is the program the browser would run, on the server's
 * document, so what is printed cannot differ from what the browser would have built.
 *
 * A global that is not allowed is passed in as a value that stops the run when anything touches it.
 * So only code that really runs at first render counts: `alert` in a click handler is no obstacle,
 * and `alert` in a component's body is. This is about determinism, not security: a project's own
 * code already runs during its build, through its Vite config and plugins.
 */
import * as runtime from '@memoized-dom/runtime';
import { renderToString } from '@memoized-dom/server';
import type { ServerComponent } from '@memoized-dom/server';
import { noteEventListeners } from '@memoized-dom/server/internal';
import { toModuleFunction } from '../../core/parse/module-function';
import { isPlainStylesheet } from '../../core/resolve/imports';
import { STABLE_GLOBALS } from '../../optimize/effects';

/** What a plain stylesheet's import gives the build: nothing. */
const NO_EXPORTS: object = Object.freeze(Object.create(null));

/** Globals with the same result on every machine and at every time. */
const ALLOWED_GLOBALS: Readonly<Record<string, unknown>> = Object.fromEntries(
  [...STABLE_GLOBALS].filter((name) => name !== 'Math').map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
);

/** Runtime helpers whose use means the page does something after it is shown. */
const LIVE_HELPERS = new Set(['setListener', 'setRowListener', 'ownedEffect', 'mountRef', 'assignRef']);

/** Methods of allowed values whose results depend on the machine's language. */
const LOCALE_METHODS: readonly (readonly [object, string])[] = [
  [Array.prototype, 'toLocaleString'],
  [BigInt.prototype, 'toLocaleString'],
  [Number.prototype, 'toLocaleString'],
  [Object.prototype, 'toLocaleString'],
  [String.prototype, 'localeCompare'],
  [String.prototype, 'toLocaleLowerCase'],
  [String.prototype, 'toLocaleUpperCase'],
];

export interface BuildRun {
  readonly html: string;
  /** Something can happen after the page is shown: a listener, an effect or a ref. */
  readonly live: boolean;
}

/** Why a run stopped. Authored `catch` can swallow it, so `escaped` is what is checked. */
class NotClosed extends Error {}

export function runAtBuild(
  output: Readonly<Record<string, string>>,
  rootModule: string,
  exportName: string,
  runtimePath: string,
  resolve: (specifier: string, importer: string) => string | false | null,
): BuildRun | null {
  let escaped = false;
  let live = false;

  /** Stops the run if anything is done with it. Having it unused changes nothing. */
  const closedOff = (name: string): unknown => {
    const stop = (): never => {
      escaped = true;
      throw new NotClosed(`${name} is not available while building`);
    };
    return new Proxy(function closed() {}, {
      apply: stop, construct: stop, defineProperty: stop, deleteProperty: stop, get: stop,
      getOwnPropertyDescriptor: stop, has: stop, ownKeys: stop, set: stop,
    });
  };

  const math = new Proxy(Math, {
    get: (target, key) => (key === 'random' ? closedOff('Math.random') : Reflect.get(target, key)),
  });
  const watchedRuntime = new Proxy(runtime as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === 'string' && LIVE_HELPERS.has(key)) live = true;
      return target[key as string];
    },
  });

  const loaded = new Map<string, object>();
  const load = (path: string): object => {
    const existing = loaded.get(path);
    if (existing !== undefined) return existing;
    const exports = Object.create(null) as object;
    loaded.set(path, exports);

    const module = toModuleFunction(output[path]!);
    const imports = module.specifiers.map((specifier) => {
      if (specifier === runtimePath) return watchedRuntime;
      // A plain stylesheet runs no code and exports nothing; the page links it instead.
      if (isPlainStylesheet(specifier)) return NO_EXPORTS;
      const target = resolve(specifier, path);
      // A package may do anything when it loads, so only the browser can load it.
      if (typeof target !== 'string' || output[target] === undefined) {
        escaped = true;
        throw new NotClosed(`${specifier} is outside the compiled modules`);
      }
      return load(target);
    });
    const exportStar = (into: object, from: object): void => {
      for (const name of Object.keys(from)) {
        if (name === 'default' || name in into) continue;
        Object.defineProperty(into, name, { enumerable: true, get: () => (from as Record<string, unknown>)[name] });
      }
    };
    // `typeof window` would see the stand-in and say "function"; nothing notices, so stop here.
    const unseen = module.bareGlobals.find((name) => !Object.hasOwn(ALLOWED_GLOBALS, name) && name !== 'Math');
    if (unseen !== undefined) {
      escaped = true;
      throw new NotClosed(`${unseen} is used in a way the build cannot stand in for`);
    }
    const globals = module.globals.map((name) => {
      if (name === 'Math') return math;
      return Object.hasOwn(ALLOWED_GLOBALS, name) ? ALLOWED_GLOBALS[name] : closedOff(name);
    });
    const run = new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body);
    run(imports, exports, exportStar, ...globals);
    return exports;
  };

  const restore = LOCALE_METHODS.map(([owner, name]) => {
    const method = (owner as Record<string, unknown>)[name];
    (owner as Record<string, unknown>)[name] = closedOff(name);
    return () => { (owner as Record<string, unknown>)[name] = method; };
  });
  const listenersBefore = noteEventListeners();

  // Whatever stops the run, the browser can still run the page, and shows any error of its own.
  try {
    const component = (load(rootModule) as Record<string, unknown>)[exportName] as ServerComponent;
    const html = renderToString(component);
    if (noteEventListeners() !== listenersBefore) live = true;
    return escaped ? null : { html, live };
  } catch {
    return null;
  } finally {
    for (const undo of restore) undo();
  }
}
