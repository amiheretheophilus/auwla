/** Recovery follows unfinished writes, without retaining completed row batches. */
import { afterEach, expect, it, spyOn } from 'bun:test';
import {
  createApplicationRuntime,
  registerEntity,
  renderDescendants,
  renderEntity,
  runWithApplicationRuntime,
  setScheduler,
  type ApplicationRuntime,
} from '../src/kernel';
import { createWriteBatch } from '../src/write-batch';
import { observeMutation } from '../src/mutation';

const runtimes: ApplicationRuntime[] = [];
const queued: (() => void)[] = [];
let scheduler: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  // Drain even after an assertion fails, so one test cannot leave a recovery
  // outstanding in the module's shared scheduler.
  while (queued.length > 0) {
    queued.shift()!();
  }
  scheduler?.mockRestore();
  scheduler = undefined;
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
});

function application(): ApplicationRuntime {
  const runtime = createApplicationRuntime();
  runtimes.push(runtime);
  runWithApplicationRuntime(runtime, () => setScheduler((run) => run()));
  return runtime;
}

function row(runtime: ApplicationRuntime, id: string, render: () => void, parent: string | null = null) {
  return runWithApplicationRuntime(runtime, () => {
    const entity = { id, parent, render };
    registerEntity(entity);
    const batch = createWriteBatch(entity);
    batch.activate();
    return batch;
  });
}

function holdRecovery(): void {
  scheduler = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
}

it('queues one recovery for a successful listener that updates 200 row batches', () => {
  const runtime = application();
  let renders = 0;
  let commits = 0;
  runWithApplicationRuntime(runtime, () => setScheduler((run) => {
    commits++;
    run();
  }));
  const owner = row(runtime, 'owner', () => {});
  const rows = Array.from({ length: 200 }, (_, index) => row(runtime, `row-${index}`, () => renders++));
  holdRecovery();
  owner.listener(() => {
    for (const batch of rows) {
      batch.mark();
    }
  })();
  expect(renders).toBe(200);
  expect(commits).toBe(1);
  expect(queued).toHaveLength(1);
});

it('bounds queued recovery while committing 200 unwrapped writes', () => {
  const runtime = application();
  let renders = 0;
  const rows = Array.from({ length: 200 }, (_, index) => row(runtime, `row-${index}`, () => renders++));
  holdRecovery();
  for (const batch of rows) {
    batch.mark();
  }
  expect(queued).toHaveLength(1);
  let callbacks = 0;
  while (queued.length > 0) {
    callbacks++;
    queued.shift()!();
  }
  expect(renders).toBe(200);
  // A continuation is reserved before entering a potentially throwing render.
  expect(callbacks).toBeLessThanOrEqual(2);
});

it('keeps first-mark order when writes from different applications interleave', () => {
  const first = application();
  const second = application();
  const rendered: string[] = [];
  const a = row(first, 'a', () => rendered.push('a'));
  const b = row(second, 'b', () => rendered.push('b'));
  const c = row(first, 'c', () => rendered.push('c'));
  holdRecovery();
  a.mark();
  b.mark();
  c.mark();
  while (queued.length > 0) {
    queued.shift()!();
  }
  expect(rendered).toEqual(['a', 'b', 'c']);
});

it('renders a child once when its pending parent writes it again', () => {
  const runtime = application();
  let renders = 0;
  let child: ReturnType<typeof createWriteBatch>;
  const parent = row(runtime, 'parent', () => child.mark());
  child = row(runtime, 'parent/child', () => renders++, 'parent');
  holdRecovery();
  parent.listener(() => {
    child.mark();
    parent.mark();
  })();
  expect(renders).toBe(1);
});

it('keeps a new write made after a child has already rendered', () => {
  const runtime = application();
  let value = 0;
  const seen: number[] = [];
  const first = row(runtime, 'first', () => seen.push(value));
  const second = row(runtime, 'second', () => {
    value = 1;
    first.mark();
  });
  holdRecovery();
  first.listener(() => {
    first.mark();
    second.mark();
  })();
  expect(seen).toEqual([0, 1]);
});

it.each(['entity', 'descendants'])('acknowledges writes consumed by an explicit %s render', (mode) => {
  const runtime = application();
  let renders = 0;
  row(runtime, 'parent', () => {});
  const child = row(runtime, 'parent/child', () => renders++, 'parent');
  holdRecovery();
  child.mark();
  runWithApplicationRuntime(runtime, () => {
    if (mode === 'entity') {
      renderEntity('parent/child');
    } else {
      renderDescendants('parent');
    }
  });
  while (queued.length > 0) {
    queued.shift()!();
  }
  expect(renders).toBe(1);
});

it('continues recovering other rows after one queued render throws', () => {
  const runtime = application();
  let firstRenders = 0;
  let secondRenders = 0;
  const failure = new Error('queued render failed');
  const first = row(runtime, 'first', () => {
    firstRenders++;
    throw failure;
  });
  const second = row(runtime, 'second', () => secondRenders++);
  holdRecovery();
  first.mark();
  second.mark();
  expect(queued.shift()!).toThrow(failure);
  while (queued.length > 0) {
    queued.shift()!();
  }
  expect(firstRenders).toBe(1);
  expect(secondRenders).toBe(1);
});

it('preserves another application recovery after a render throws', () => {
  const firstRuntime = application();
  const secondRuntime = application();
  let renders = 0;
  const first = row(firstRuntime, 'row', () => { throw new Error('first application'); });
  const second = row(secondRuntime, 'row', () => renders++);
  holdRecovery();
  first.mark();
  second.mark();
  expect(queued.shift()!).toThrow('first application');
  while (queued.length > 0) {
    queued.shift()!();
  }
  expect(renders).toBe(1);
});

it('preserves remaining rows when opaque mutation recovery throws', () => {
  const runtime = application();
  let renders = 0;
  const owner = row(runtime, 'owner', () => {});
  const first = row(runtime, 'first', () => renders++);
  const second = row(runtime, 'second', () => renders++);
  const value = { count: 0 };
  holdRecovery();
  runWithApplicationRuntime(runtime, () => {
    expect(owner.listener(() => {
      observeMutation([() => value], [() => { throw new Error('opaque notification'); }]);
      value.count++;
      first.mark();
      second.mark();
      throw new Error('listener');
    })).toThrow('listener');
  });
  expect(queued.shift()!).toThrow('opaque notification');
  while (queued.length > 0) {
    queued.shift()!();
  }
  expect(renders).toBe(2);
});

it('preserves extracted batch methods used as callbacks', () => {
  const runtime = application();
  let renders = 0;
  const { mark, flush, listener } = row(runtime, 'row', () => renders++);
  holdRecovery();
  listener(mark)();
  expect(renders).toBe(1);
  mark();
  flush();
  expect(renders).toBe(2);
});
