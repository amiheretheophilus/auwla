import { expect, it } from 'bun:test';
import { captureMutationScope, mutationTarget, observeMutation } from '../src/mutation';

it('observes cyclic data, symbols, hidden fields and native collections without invoking getters', () => {
  const key = Symbol();
  let getterCalls = 0, notifications = 0;
  const value: any = { map: new Map([[1, { n: 1 }]]), set: new Set([1]), get unused() { getterCalls++; return 0; } };
  value.self = value;
  Object.defineProperty(value, key, { value: 1, writable: true });
  const observe = () => observeMutation([() => value], [() => notifications++]);
  observe().finish(undefined);
  expect(notifications).toBe(0);
  const first = observe();
  value.map.get(1).n++;
  first.finish('native result');
  const second = observe();
  value[key]++;
  value.set.add(2);
  expect(second.finish(9)).toBe(9);
  expect(notifications).toBe(2);
  expect(getterCalls).toBe(0);
});

it('recovers partial mutations synchronously at a catch boundary and only reports once', async () => {
  const item = { count: 0 };
  let notifications = 0;
  const restore = captureMutationScope();
  const observation = observeMutation([() => item], [() => notifications++]);
  item.count++;
  restore();
  expect(notifications).toBe(1);
  observation.finish(undefined);
  await Promise.resolve();
  expect(notifications).toBe(1);
});

it('retains key coercion and reports only completed native stores', () => {
  const log: unknown[] = [];
  const item = { count: 1 };
  const key = { [Symbol.toPrimitive]() { log.push('key'); return 'count'; } };
  const target = mutationTarget(item, key, () => log.push('write'));
  log.push('rhs');
  target.value = 4;
  expect(log).toEqual(['key', 'rhs', 'write']);
  expect(item.count).toBe(4);
});
