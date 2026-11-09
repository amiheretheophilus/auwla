/**
 * Runs a case on the reference renderer and on a compiler, and compares what
 * the user sees after the first render and after every step.
 */
import { afterEach, expect, it, jest } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beginReferenceScope, renderApp, type Component } from '../reference/runtime';
import { toReferenceModules } from '../reference/transform';
import { beginSources, finishSourceDeclarations } from '../reference/sources';
import { clearDeferred, describeStep, rejectDeferred, resolveDeferred, usesClock, type Case, type Step } from './case';
import { clearRequests, fetchForCase, rejectRequest, respond } from './requests';
import { compileModulesDetailed } from '../../src';
import { clearCompiledApps, comparisonCompilers, importAsServer, type Compiler } from './compilers';
import { serialize } from './serialize';

const OUT = join(import.meta.dirname, '..', 'out');
const RUNTIME_URL = pathToFileURL(join(import.meta.dirname, '..', 'reference', 'runtime.ts')).href;

const cleanups = new Set<() => void>();
// Bun registers a hook in a shared module only for the first test file that
// imports it, so `behaves` also disposes leftovers before each case.
afterEach(disposeRuns);

/**
 * Dispose every app, source and pending request, even after a failed run.
 * Called after each test, and by the generators after each program: a program
 * that threw must not leave requests for the next one to answer.
 */
export function disposeRuns(): void {
  clearCompiledApps();
  for (const cleanup of [...cleanups].reverse()) cleanup();
  cleanups.clear();
  clearDeferred();
  clearRequests();
}

/** A failed assertion must not leave an app, effects or DOM in the next case. */
function track(cleanup: () => void): () => void {
  const release = () => {
    cleanups.delete(release);
    cleanup();
  };
  cleanups.add(release);
  return release;
}

/** Register a test: the compiled app must look like the reference after every step. */
export function behaves(name: string, testCase: Case): void {
  it(name, async () => {
    disposeRuns();
    // Validate the oracle's explicit checks before a new compiler is available.
    if (process.env.REFERENCE_ONLY === '1') {
      await runOnReference(name, testCase);
      return;
    }
    const { reference, compiled } = await observeBoth(name, testCase);
    expect(compiled).toEqual(reference);
    checkDelivery(testCase, reference);
  });
}

/**
 * A page delivered as HTML has no program, so that HTML must be what the reference renders, and no
 * step of the case may change it (`wiki/compiler/delivery.md`).
 */
function checkDelivery(testCase: Case, reference: Observations): void {
  const { initialRender } = compileModulesDetailed({
    ...testCase.modules,
    './App.tsx': testCase.source,
    './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`,
  });
  if (initialRender.kind !== 'html') return;

  // A style written property by property ends in `;`, and parsed from HTML it need not.
  const withoutFinalSemicolon = (html: string) => html.replace(/;"/g, '"');

  const page = document.createElement('div');
  page.innerHTML = initialRender.html;
  const delivered = withoutFinalSemicolon(serialize(page));
  for (const observation of reference) {
    expect(withoutFinalSemicolon(observation.slice(observation.indexOf('\n') + 1))).toBe(delivered);
  }
}

/** One entry per observation: what happened, then the HTML. */
export type Observations = string[];

/** Run both next strategies against one reference observation sequence. */
export async function observeBoth(
  name: string,
  testCase: Case
): Promise<{ reference: Observations; compiled: Observations }> {

  const reference = await runOnReference(name, testCase);
  const compilers = comparisonCompilers();
  const compiled = await runOnCompiler(name, testCase, compilers[0]!);
  for (const compiler of compilers.slice(1)) {
    const general = await runOnCompiler(name, testCase, compiler);
    expect(general).toEqual(reference);
    expect(general).toEqual(compiled);
  }
  return { reference, compiled };
}

/** Run a case on the reference only. */
export async function runOnReference(name: string, testCase: Case): Promise<Observations> {
  
  const clock = startClock(testCase);
  const disposeSources = track(beginSources(fetchForCase));
  const disposeModules = track(beginReferenceScope());
  const authored = { ...testCase.modules, './App.tsx': testCase.source };
  const files = toReferenceModules(authored, RUNTIME_URL);
  const module = await importFiles(name, 'reference', files, 'App.tsx');
  finishSourceDeclarations();

  const container = attachContainer();
  const errors = watchErrors();
  const app = renderApp(module.App as Component, container);
  const unmount = track(() => app.unmount());
  await settle(clock);
  app.render();
  errors.check('initial render');
  const observations = [observe('initial render', container)];
  testCase.check?.(container, 0);

  for (const step of testCase.steps ?? []) {
    perform(step, container);
    await settle(clock);
    app.render();
    // The reference derives at render, so a source that render starts (`$read` of a promise made
    // from changed state) begins only now. Compiled code derives at the write, so it already began.
    await settle(clock);
    app.render();
    await waitForElement(step, container, clock, () => app.render());
    errors.check(describeStep(step));
    observations.push(observe(describeStep(step), container));
    testCase.check?.(container, observations.length - 1);
  }

  unmount();
  disposeModules();
  disposeSources();
  container.remove();
  clearDeferred();
  clearRequests();
  clock.stop();
  return observations;
}

async function runOnCompiler(name: string, testCase: Case, compiler: Compiler): Promise<Observations> {
  const clock = startClock(testCase);
  const disposeSources = track(compiler.prepare());
  // Folders from older runs would show stale or other-compiler output.
  rmSync(join(OUT, slug(name), 'compiled'), { recursive: true, force: true });
  let files: Record<string, string>;
  try {
    files = compiler.compile(testCase.source, testCase.modules, testCase.compileTimeoutMs);
  } catch (error) {
    // A case that does not compile still shows why, in place of its output.
    writeFiles(name, compiler.output, { 'ERROR.txt': `${compiler.name}\n\n${(error as Error).message}\n` });
    throw error;
  }
  // A server renders from its own copy of the modules, whose state starts fresh as in another
  // process. It loads first: module sources are described per process, and a later load replaces
  // the description as a hot update would, so the browser's copy must be the last.
  const served = compiler.serves === true
    ? await importAsServer(() => importFiles(name, `${compiler.output}-server`, files, 'App.tsx'))
    : undefined;
  const module = await importFiles(name, compiler.output, files, 'App.tsx');

  const container = attachContainer();
  const errors = watchErrors();
  const app = compiler.mount(module, container, served);
  const unmount = track(() => app.unmount());
  await settle(clock);
  errors.check('initial render');
  const observations = [observe('initial render', container)];
  testCase.check?.(container, 0);

  for (const step of testCase.steps ?? []) {
    perform(step, container);
    await settle(clock);
    await waitForElement(step, container, clock, () => {});
    errors.check(describeStep(step));
    observations.push(observe(describeStep(step), container));
    testCase.check?.(container, observations.length - 1);
  }

  unmount();
  disposeSources();
  container.remove();
  clearDeferred();
  clearRequests();
  clock.stop();
  return observations;
}

// ---------------------------------------------------------------------------

function perform(step: Step, container: HTMLElement): void {
  if ('advance' in step) {
    jest.advanceTimersByTime(step.advance);
    return;
  }
  if ('respond' in step) {
    respond(step.respond, step.value, step.status);
    return;
  }
  if ('rejectRequest' in step) {
    rejectRequest(step.rejectRequest, step.message);
    return;
  }
  if ('reject' in step) {
    rejectDeferred(step.reject, step.message);
    return;
  }
  if ('resolve' in step) {
    resolveDeferred(step.resolve, step.value);
    return;
  }

  const selector = 'click' in step ? step.click : step.input;
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`case: no element matches ${selector}`);

  if ('click' in step) {
    (element as HTMLElement).click();
    return;
  }
  (element as HTMLInputElement).value = step.value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function observe(label: string, container: HTMLElement): string {
  return `after ${label}:\n${serialize(container)}`;
}

/**
 * An exception in an event handler does not reach the code that clicked: the DOM
 * reports it as a window `error` event and carries on. A case must fail on it.
 */
function watchErrors(): { check(label: string): void } {
  const errors: unknown[] = [];
  const listener = (event: Event) => errors.push((event as ErrorEvent).error ?? event);
  window.addEventListener('error', listener);
  track(() => window.removeEventListener('error', listener));
  return {
    check(label) {
      if (errors.length === 0) return;
      const error = errors[0];
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`an event handler threw after ${label}: ${message}`, { cause: error });
    },
  };
}

interface Clock {
  readonly fake: boolean;
  stop(): void;
}

/**
 * A case with an `advance` step runs on fake timers, installed before its
 * modules load, so a timer set at module or component setup is faked too.
 */
function startClock(testCase: Case): Clock {
  
  if (!usesClock(testCase.steps)) return { fake: false, stop() {} };
  jest.useFakeTimers();
  const stop = track(() => jest.useRealTimers());
  return { fake: true, stop };
}

/** Let promises and timers that are already due run. */
async function settle(clock: Clock): Promise<void> {
  for (let round = 0; round < 3; round++) {
    if (clock.fake) {
      // Fake timers do not advance by themselves: run the ones already due,
      // then let promises run. `setImmediate` is not faked.
      jest.advanceTimersByTime(0);
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * Wait for the element a click step names in `until`. The reference draws only when told to,
 * so `refresh` draws it again each round; compiled code draws by itself.
 */
async function waitForElement(step: Step, container: HTMLElement, clock: Clock, refresh: () => void): Promise<void> {
  if (!('click' in step) || step.until === undefined) return;

  const deadline = performance.now() + 4000;

  while (container.querySelector(step.until) === null) {
    if (performance.now() > deadline) throw new Error(`case: nothing matched ${step.until} after ${describeStep(step)}`);
    await settle(clock);
    refresh();
  }
}

function attachContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  track(() => container.remove());
  return container;
}

/** Write a case's files to `tests/out/<case>/<kind>/` and import the entry. */
async function importFiles(name: string, kind: string, files: Record<string, string>, entry: string) {
  const directory = writeFiles(name, kind, files);
  return (await import(pathToFileURL(join(directory, entry)).href)) as Record<string, unknown>;
}

/** Replace `tests/out/<case>/<kind>/` with `files`. */
function writeFiles(name: string, kind: string, files: Record<string, string>): string {
  const directory = join(OUT, slug(name), kind);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [file, code] of Object.entries(files)) {
    const path = join(directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, code);
  }
  return directory;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
