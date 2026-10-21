import { afterEach, expect, it } from 'bun:test';
import {
  createApplicationRuntime, invalidateEntity, registerEntity, runWithApplicationRuntime, setScheduler,
  type ApplicationRuntime,
} from '../src/kernel';
import { captureBuildScope, createBuildScope } from '../src/build-scope';

const runtimes: ApplicationRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function create() {
  const runtime = createApplicationRuntime();
  runtimes.push(runtime);
  return runtime;
}

it('shares the invocation owner with a lexical block while tracking its own active frame', () => {
  const runtime = create();
  runWithApplicationRuntime(runtime, () => {
    const parent = createBuildScope();
    const outer = parent.enter();
    const block = createBuildScope(true, true);
    expect(block.active()).toBe(false);
    const inner = block.enter();
    expect(parent.building()).toBe(true);
    expect(block.building()).toBe(true);
    expect(block.active()).toBe(true);
    block.leave(inner);
    expect(block.active()).toBe(false);
    expect(parent.building()).toBe(true);
    parent.leave(outer);
  });
});

it('settles escaped block storage once when an authored catch restores the parent', () => {
  const runtime = create();
  runWithApplicationRuntime(runtime, () => {
    const parent = createBuildScope();
    const outer = parent.enter();
    const restore = captureBuildScope();
    const block = createBuildScope(true, true);
    let completed = 0;
    const inner = block.enter(() => { completed++; block.leave(inner); });
    restore();
    expect(completed).toBe(1);
    expect(block.active()).toBe(false);
    expect(parent.building()).toBe(true);
    restore();
    expect(completed).toBe(1);
    parent.leave(outer);
  });
});

it('restores the captured owner after nested setup fails, including no owner', () => {
  const runtime = create();
  runWithApplicationRuntime(runtime, () => {
    const parent = createBuildScope();
    const child = createBuildScope();
    const outside = captureBuildScope();
    parent.enter();
    const restore = captureBuildScope();
    child.enter();
    restore();
    expect(parent.building()).toBe(true);
    expect(child.building()).toBe(false);
    outside();
    expect(parent.building()).toBe(false);
  });
});

it('does not restore a captured owner after its synchronous turn', async () => {
  const runtime = create();
  const scope = runWithApplicationRuntime(runtime, createBuildScope);
  const restore = runWithApplicationRuntime(runtime, () => {
    scope.enter();
    return captureBuildScope();
  });
  await Promise.resolve();
  runWithApplicationRuntime(runtime, () => {
    restore();
    expect(scope.building()).toBe(false);
  });
});

it('uses the currently executing owner and restores nested setup ownership', () => {
  const runtime = create();
  runWithApplicationRuntime(runtime, () => {
    const parent = createBuildScope();
    const child = createBuildScope();
    const outer = parent.enter();
    expect(parent.building()).toBe(true);
    const inner = child.enter();
    expect(parent.building()).toBe(false);
    expect(child.building()).toBe(true);
    child.leave(inner);
    expect(parent.building()).toBe(true);
    expect(child.building()).toBe(false);
    parent.leave(outer);
    expect(parent.building()).toBe(false);
  });
});

it('keeps application ownership separate', () => {
  const first = create();
  const second = create();
  runWithApplicationRuntime(first, () => {
    const owner = createBuildScope();
    const frame = owner.enter();
    runWithApplicationRuntime(second, () => {
      const other = createBuildScope();
      const nested = other.enter();
      expect(owner.building()).toBe(false);
      expect(other.building()).toBe(true);
      other.leave(nested);
    });
    expect(owner.building()).toBe(true);
    owner.leave(frame);
  });
});

it('uses the active application for a shared owner created outside either application', () => {
  const owner = createBuildScope(true);
  const first = create(), second = create();
  runWithApplicationRuntime(first, () => {
    const frame = owner.enter();
    const nested = createBuildScope();
    const inner = nested.enter();
    expect(owner.building()).toBe(false);
    expect(owner.active()).toBe(true);
    runWithApplicationRuntime(second, () => {
      expect(owner.active()).toBe(false);
      const other = owner.enter();
      expect(owner.building()).toBe(true);
      owner.leave(other);
    });
    nested.leave(inner);
    expect(owner.building()).toBe(true);
    owner.leave(frame);
  });
});

it('discards abandoned setup frames before a later continuation', async () => {
  const runtime = create();
  const scope = runWithApplicationRuntime(runtime, createBuildScope);
  let frame: ReturnType<typeof scope.enter>;
  expect(() => runWithApplicationRuntime(runtime, () => {
    frame = scope.enter();
    throw new Error('setup');
  })).toThrow('setup');
  await Promise.resolve();
  runWithApplicationRuntime(runtime, () => {
    expect(scope.building()).toBe(false);
    const current = scope.enter();
    scope.leave(frame!);
    expect(scope.building()).toBe(true);
    scope.leave(current);
    expect(scope.building()).toBe(false);
  });
});

it('clears ownership when a scheduled replay throws', () => {
  const runtime = create();
  runWithApplicationRuntime(runtime, () => {
    const scope = createBuildScope();
    registerEntity({ id: 'throwing', parent: null, render() {
      scope.enter();
      throw new Error('replay');
    } });
    setScheduler((run) => run());
    expect(() => invalidateEntity('throwing')).toThrow('replay');
    expect(scope.building()).toBe(false);
  });
});
