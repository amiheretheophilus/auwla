import { afterEach, beforeEach, expect, it, vi } from 'bun:test';
import {
  _internals, commit, markDirty, register, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';

beforeEach(() => setScheduler(run => run()));
afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  resetScheduler();
});

it('retains a full retry after a partial render fails and drains it with later work', () => {
  const failure = new Error('render failed');
  let fail = true;
  const render = vi.fn(() => { if (fail) throw failure; });
  const peer = vi.fn();
  register({ id: 'owner', parent: null, render });
  register({ id: 'peer', parent: null, render: peer });
  expect(() => markDirty('owner')).toThrow(failure);
  expect(_internals().dirtySet.has('owner')).toBe(true);
  fail = false;
  markDirty('peer');
  expect(render).toHaveBeenCalledTimes(2);
  expect(peer).toHaveBeenCalledTimes(1);
  expect(_internals().dirtySet.size).toBe(0);
});

it.each([false, true])('does not revive an entity removed during a failed render (replace=%s)', replace => {
  const replacement = vi.fn();
  register({ id: 'owner', parent: null, render() {
    unregister('owner');
    if (replace) register({ id: 'owner', parent: null, render: replacement });
    throw new Error('removed');
  } });
  expect(() => markDirty('owner')).toThrow('removed');
  expect(_internals().dirtySet.has('owner')).toBe(false);
  expect(_internals().registry.has('owner')).toBe(replace);
  expect(replacement).not.toHaveBeenCalled();
});

it('does not automatically retry a failed effect with later unrelated work', () => {
  const effect = vi.fn(() => { throw new Error('effect failed'); });
  register({ id: 'effect', parent: null, phase: 'effect', render: effect });
  register({ id: 'peer', parent: null, render() {} });
  expect(() => markDirty('effect')).toThrow('effect failed');
  expect(_internals().dirtySet.has('effect')).toBe(false);
  markDirty('peer');
  expect(effect).toHaveBeenCalledTimes(1);
});

it('settles siblings and their cascades after a render fails, deferring effects and failed descendants', () => {
  setScheduler(() => {});
  const failure = new Error('bad branch'), calls: string[] = [];
  let fail = true;
  register({id:'root',parent:null,render() {}});
  register({id:'bad',parent:'root',render() { calls.push('bad'); if (fail) throw failure; }});
  register({id:'child',parent:'bad',render() { calls.push('child'); }});
  register({id:'sibling',parent:'root',render() { calls.push('sibling'); markDirty('cascade'); }});
  register({id:'cascade',parent:'sibling',render() { calls.push('cascade'); }});
  register({id:'effect',parent:'root',phase:'effect',render() { calls.push('effect'); }});
  for (const id of ['bad','child','sibling','effect']) markDirty(id);
  expect(() => commit()).toThrow(failure);
  expect(calls).toEqual(['bad','sibling','cascade']);
  expect([..._internals().dirtySet]).toEqual(['child','effect','bad']);
  fail = false; commit();
  expect(calls).toEqual(['bad','sibling','cascade','bad','child','effect']);
  expect(_internals().dirtySet.size).toBe(0);
});

it('reports independent failures together without repeatedly retrying either render', () => {
  setScheduler(() => {});
  const first = new Error('first'), second = new Error('second'), calls: string[] = [];
  for (const [id,error] of [['a',first],['b',second]] as const) register({id,parent:null,render() {calls.push(id); throw error;}});
  register({id:'peer',parent:null,render() {calls.push('peer');}});
  for (const id of ['a','b','peer']) markDirty(id);
  let error: unknown; try {commit();} catch (caught) {error=caught;}
  expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([first,second]);
  expect(calls).toEqual(['a','b','peer']); expect([..._internals().dirtySet]).toEqual(['a','b']);
});

it('does not render a stale batch entry after a peer replaces its entity', () => {
  setScheduler(() => {}); const stale = vi.fn(), replacement = vi.fn();
  register({id:'owner',parent:null,render() {
    unregister('peer'); register({id:'peer',parent:null,render:replacement}); markDirty('peer');
  }});
  register({id:'peer',parent:null,render:stale});
  markDirty('owner'); markDirty('peer'); commit();
  expect(stale).not.toHaveBeenCalled(); expect(replacement).toHaveBeenCalledTimes(1);
});
