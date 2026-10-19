/**
 * Runs a case on the reference renderer and on a compiler, and compares what
 * the user sees after the first render and after every step.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderApp, type Component } from '../reference/runtime';
import { toReference } from '../reference/transform';
import { clearDeferred, describeStep, resolveDeferred, type Case, type Step } from './case';
import { clearCompiledApps, selectedCompiler, type Compiler } from './compilers';
import { serialize } from './serialize';

const OUT = join(import.meta.dirname, '..', 'out');
const RUNTIME_URL = pathToFileURL(join(import.meta.dirname, '..', 'reference', 'runtime.ts')).href;

const cleanups = new Set<() => void>();
afterEach(() => {
  clearCompiledApps();
  for (const cleanup of [...cleanups].reverse()) cleanup();
  cleanups.clear();
  clearDeferred();
});

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
    // Validate the oracle's explicit checks before a new compiler is available.
    if (process.env.REFERENCE_ONLY === '1') {
      await runOnReference(name, testCase);
      return;
    }
    const { reference, compiled } = await observeBoth(name, testCase);
    expect(compiled).toEqual(reference);
  });
}

/** One entry per observation: what happened, then the HTML. */
export type Observations = string[];

/** Run a case on the reference and on the selected compiler. */
export async function observeBoth(name: string, testCase: Case): Promise<{ reference: Observations; compiled: Observations }> {
  const reference = await runOnReference(name, testCase);
  const compiled = await runOnCompiler(name, testCase, selectedCompiler());
  return { reference, compiled };
}

async function runOnReference(name: string, testCase: Case): Promise<Observations> {
  const code = toReference(testCase.source, 'App.tsx', RUNTIME_URL);
  const module = await importFiles(name, 'reference', { 'App.js': code }, 'App.js');

  const container = attachContainer();
  const app = renderApp(module.App as Component, container);
  const unmount = track(() => app.unmount());
  const observations = [observe('initial render', container)];
  testCase.check?.(container, 0);

  for (const step of testCase.steps ?? []) {
    perform(step, container);
    await settle();
    app.render();
    observations.push(observe(describeStep(step), container));
    testCase.check?.(container, observations.length - 1);
  }

  unmount();
  container.remove();
  clearDeferred();
  return observations;
}

async function runOnCompiler(name: string, testCase: Case, compiler: Compiler): Promise<Observations> {
  const files = compiler.compile(testCase.source);
  const module = await importFiles(name, 'compiled', files, 'App.tsx');

  const container = attachContainer();
  const app = compiler.mount(module, container);
  const unmount = track(() => app.unmount());
  await settle();
  const observations = [observe('initial render', container)];
  testCase.check?.(container, 0);

  for (const step of testCase.steps ?? []) {
    perform(step, container);
    await settle();
    observations.push(observe(describeStep(step), container));
    testCase.check?.(container, observations.length - 1);
  }

  unmount();
  container.remove();
  clearDeferred();
  return observations;
}

// ---------------------------------------------------------------------------

function perform(step: Step, container: HTMLElement): void {
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

/** Let promises and timers that are already due run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
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
  const directory = join(OUT, slug(name), kind);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [file, code] of Object.entries(files)) writeFileSync(join(directory, file), code);
  return (await import(pathToFileURL(join(directory, entry)).href)) as Record<string, unknown>;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
