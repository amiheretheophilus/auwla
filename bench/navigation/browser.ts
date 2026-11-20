/**
 * The in-page side of the navigation benchmark. A generated entry (`build.ts`) imports one
 * compiled variant of `app.tsx` and calls `install`, which exposes `__validate` and `__run`.
 *
 * Every operation is checked outside the timing: one page on screen, its heading, and the count
 * the app passed down. Timed loops check the state they end in.
 */
import { setScheduler, mount, type MountedApplication } from '@memoized-dom/runtime';
import { createMemoryRouteHistory, createRouteRuntime, navigate, setActiveRouteRuntime } from '@memoized-dom/router';

// The router runs on a memory history, as router benchmarks do. Browsers throttle the History API
// (about 200 calls in 10 seconds) and drop the rest, so thousands of navigations would time the
// throttle, and the address bar would fall behind the router. This module runs before the compiled
// app it is bundled with (`build.ts`), so the app's route table and first route use this runtime.
setActiveRouteRuntime(createRouteRuntime({ routeHistory: createMemoryRouteHistory({ initialEntries: ['/p3'] }) }));

export interface Scenario {
  readonly name: string;
  readonly operations: number;
}

export interface ScenarioSamples {
  readonly name: string;
  /** Nanoseconds per operation, one per sample. */
  readonly samples: number[];
}

type Component = Parameters<typeof mount>[1];

export const SCENARIOS: readonly Scenario[] = [
  { name: 'mount and unmount the app on a page', operations: 400 },
  { name: 'navigate between ten pages', operations: 2_000 },
  { name: 'change a path parameter', operations: 2_000 },
  { name: 'update a prop of the page on screen', operations: 5_000 },
  { name: 'change only the query', operations: 2_000 },
];

const SAMPLES = 7;
const WARMUP = 200;

export function install(App: Component): void {
  setScheduler((commit) => commit());
  const host = document.getElementById('root')!;
  let app: MountedApplication | null = null;
  let count = 0;

  function go(path: string, query?: Record<string, string>): void {
    const result = navigate(path as never, { replace: true, ...(query === undefined ? {} : { query }) } as never) as unknown;
    const status = (result as { status?: string } | null)?.status;
    if (status !== 'completed') throw new Error(`navigation to ${path} did not complete at once (${String(status)})`);
  }

  function check(page: string, heading: string): void {
    const pages = host.querySelectorAll('[data-page]');
    if (pages.length !== 1) throw new Error(`expected one page for ${heading}, found ${pages.length}`);
    const shown = pages[0]!;
    if (shown.getAttribute('data-page') !== page) throw new Error(`expected page ${page}, found ${shown.getAttribute('data-page')}`);
    const title = shown.querySelector('h1')?.textContent;
    if (title !== heading) throw new Error(`expected heading '${heading}', found '${title}'`);
    const shownCount = shown.querySelector('.count')?.textContent;
    if (shownCount !== String(count)) throw new Error(`expected count ${count}, found '${shownCount}'`);
  }

  /**
   * Mounts a fresh app on /p3. The navigation comes first: unmounting disconnects the router from
   * the window, and a navigation with no app mounted is a document load, as a plain link is.
   */
  function start(): void {
    go('/p3');
    app?.unmount();
    count = 0;
    app = mount(host, App);
    check('p3', 'p3');
  }

  function bump(): void {
    (host.querySelector('#bump') as HTMLButtonElement).click();
    count++;
  }

  /** One operation of a scenario: `index` picks the target, `checked` checks after it. */
  const operations: Record<string, (index: number, checked: boolean) => void> = {
    'mount and unmount the app on a page'(_index, checked) {
      app!.unmount();
      count = 0;
      app = mount(host, App);
      if (checked) check('p3', 'p3');
    },
    'navigate between ten pages'(index, checked) {
      const page = `p${index % 10}`;
      go(`/${page}`);
      if (checked) check(page, page);
    },
    'change a path parameter'(index, checked) {
      const id = String(index % 2 + 1);
      go(`/posts/${id}`);
      if (checked) check('post', `post ${id}`);
    },
    'update a prop of the page on screen'(_index, checked) {
      bump();
      if (checked) check('p3', 'p3');
    },
    'change only the query'(index, checked) {
      go('/p3', { tab: String(index % 2) });
      if (checked) check('p3', 'p3');
    },
  };

  /** Where each scenario starts, and how its last operation is checked. */
  function prepare(name: string): void {
    start();
    if (name === 'change a path parameter') go('/posts/2');
  }

  function finalCheck(name: string, last: number): void {
    operations[name]!(last, true);
  }

  Object.assign(window, {
    __validate(): string[] {
      const passed: string[] = [];
      for (const scenario of SCENARIOS) {
        prepare(scenario.name);
        for (let index = 0; index < 50; index++) operations[scenario.name]!(index, true);
        passed.push(scenario.name);
      }
      app?.unmount();
      app = null;
      host.textContent = '';
      return passed;
    },
    __run(): ScenarioSamples[] {
      const results: ScenarioSamples[] = [];
      for (const scenario of SCENARIOS) {
        const operate = operations[scenario.name]!;
        prepare(scenario.name);
        for (let index = 0; index < WARMUP; index++) operate(index, false);
        const samples: number[] = [];
        for (let sample = 0; sample < SAMPLES; sample++) {
          const started = performance.now();
          for (let index = 0; index < scenario.operations; index++) operate(index, false);
          const elapsed = performance.now() - started;
          samples.push((elapsed * 1e6) / scenario.operations);
          // The state the loop ended in, checked outside the timing.
          finalCheck(scenario.name, scenario.operations);
        }
        results.push({ name: scenario.name, samples });
        console.log(`timed '${scenario.name}': ${samples.map((value) => value.toFixed(0)).join(', ')} ns per operation`);
      }
      app?.unmount();
      app = null;
      return results;
    },
    __ready: true,
  });
}
