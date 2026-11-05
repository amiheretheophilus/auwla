/** One shared listener per list must behave exactly as one native listener per row. */
import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createApplicationRuntime, registerEntity, runWithApplicationRuntime, setScheduler } from '../src/kernel';
import { setRowListener } from '../src/setters';
import { createWriteBatch } from '../src/write-batch';

const document = new Window().document as unknown as Document;

function batchFor(id: string, render: () => void = () => {}) {
  const runtime = createApplicationRuntime();
  return runWithApplicationRuntime(runtime, () => {
    setScheduler((run) => run());
    const entity = { id, parent: null, render };
    registerEntity(entity);
    const batch = createWriteBatch(entity);
    batch.activate();
    return { batch, inRuntime: <T>(run: () => T) => runWithApplicationRuntime(runtime, run) };
  });
}

it('runs each row its own handler, with the native receiver and arguments', () => {
  const { batch, inRuntime } = batchFor('rows');
  const seen: unknown[][] = [];
  const first = document.createElement('li');
  const second = document.createElement('li');

  inRuntime(() => {
    setRowListener(first, 'click', function (this: unknown, event: Event) { seen.push(['first', this, event.currentTarget]); }, batch);
    setRowListener(second, 'click', function (this: unknown, event: Event) { seen.push(['second', this, event.currentTarget]); }, batch);
    first.dispatchEvent(new (first.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('click'));
    second.dispatchEvent(new (second.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('click'));
  });

  expect(seen).toEqual([['first', first, first], ['second', second, second]]);
});

it('keeps separate handlers per event on one element', () => {
  const { batch, inRuntime } = batchFor('events');
  const seen: string[] = [];
  const row = document.createElement('li');
  const EventClass = (row.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event;

  inRuntime(() => {
    setRowListener(row, 'click', () => seen.push('click'), batch);
    setRowListener(row, 'keydown', () => seen.push('keydown'), batch);
    row.dispatchEvent(new EventClass('keydown'));
    row.dispatchEvent(new EventClass('click'));
  });

  expect(seen).toEqual(['keydown', 'click']);
});

it('keeps native order with listeners the program adds, and stopPropagation', () => {
  const { batch, inRuntime } = batchFor('order');
  const seen: string[] = [];
  const list = document.createElement('ul');
  const row = document.createElement('li');
  list.append(row);
  const EventClass = (row.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event;

  inRuntime(() => {
    row.addEventListener('click', () => seen.push('before'));
    setRowListener(row, 'click', (event: Event) => { seen.push('row'); event.stopPropagation(); }, batch);
    row.addEventListener('click', () => seen.push('after'));
    list.addEventListener('click', () => seen.push('list'));
    row.dispatchEvent(new EventClass('click', { bubbles: true }));
  });

  expect(seen).toEqual(['before', 'row', 'after']);
});

it('runs on a detached row, and commits its writes when it returns', () => {
  let renders = 0;
  const { batch, inRuntime } = batchFor('detached', () => { renders++; });
  const row = document.createElement('li');
  const EventClass = (row.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event;
  let ran = false;

  inRuntime(() => {
    setRowListener(row, 'click', () => { ran = true; batch.mark(); }, batch);
    row.dispatchEvent(new EventClass('click'));
  });

  expect(ran).toBe(true);
  expect(renders).toBe(1);
});
