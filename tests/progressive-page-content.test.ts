/**
 * A progressive server page in a compiled child site (`render-value.ts`, `mountPage`). These ran
 * on the old compiler's content region until it went (2026-11-18).
 */
import { afterEach, expect, it } from 'bun:test';
import { acceptPageContent, type PageContent } from '../packages/runtime/src/page-content';
import { createValueSlot } from '../packages/runtime/src/render-value';
import { registerEntity, unregisterSubtree } from '../packages/runtime/src/kernel';

afterEach(() => { unregisterSubtree('one'); unregisterSubtree('two'); document.body.replaceChildren(); });
const shell = '<div><h1>Static</h1><input value="initial"><section><!--mmd:g:summary--><i>Summary loading</i><!--/mmd--></section><aside><!--mmd:g:notes--><i>Notes loading</i><!--/mmd--></aside></div>';
function value(sequence: number, regions: NonNullable<PageContent['progress']>['regions'] = [], complete = false, generation = 'first'): PageContent {
  return acceptPageContent({ $mmd: 'page', version: 1, id: 'board', html: shell, progress: { id: generation, sequence, complete, regions } });
}

/** A host element with a compiled child site owned by `id`. */
function site(id = 'one') {
  const host = document.createElement('main');
  const text = document.createTextNode('');
  host.append(text);
  document.body.append(host);
  const entity = { id, parent: null, render() {} };
  registerEntity(entity);
  return { host, slot: createValueSlot(text, { id, entity, batch: null }) };
}

it('fills only ready regions and retains static nodes, typed input and sibling loading UI', () => {
  const { host, slot } = site();
  slot.write(value(1));
  const heading = host.querySelector('h1'), input = host.querySelector('input')!;
  input.value = 'unsaved';
  input.focus();
  const summary = { id: 'summary', html: '<p>Summary ready 🌍</p>', sequence: 2 };
  slot.write(value(2, [summary]));
  expect(host.querySelector('section')?.textContent).toBe('Summary ready 🌍');
  expect(host.querySelector('aside')?.textContent).toBe('Notes loading');
  expect(host.querySelector('h1')).toBe(heading);
  expect(host.querySelector('input')).toBe(input);
  expect(input.value).toBe('unsaved');
  expect(document.activeElement).toBe(input);
  slot.write(value(4, [summary, { id: 'notes', html: '<p>Notes ready</p>', sequence: 3 }], true));
  expect(host.querySelector('aside')?.textContent).toBe('Notes ready');
  expect(host.querySelector('input')).toBe(input);
  slot.dispose();
  expect(host.querySelector('div')).toBeNull();
});

it('scopes equal compiler range IDs to their own mounted page and handles skipped frames', () => {
  const one = site('one'), two = site('two');
  one.slot.write(value(1));
  two.slot.write(value(1));
  one.slot.write(value(3, [{ id: 'summary', html: '<p>Ready</p>', sequence: 2 }, { id: 'notes', html: '<p>Done</p>', sequence: 3 }], true));
  expect(one.host.querySelector('aside')?.textContent).toBe('Done');
  expect(two.host.querySelector('aside')?.textContent).toBe('Notes loading');
  one.slot.dispose();
  two.slot.dispose();
});

it('keeps a committed page until a replacement generation completes', () => {
  const { host, slot } = site();
  slot.write(value(1, [], true));
  const original = host.querySelector('div');
  slot.write(value(1, [], false, 'replacement'));
  expect(host.querySelector('div')).toBe(original);
  slot.write(acceptPageContent({ ...value(2, [], true, 'replacement'), html: '<div><h1>Replacement ready</h1></div>' }));
  expect(host.querySelector('div') === original).toBe(false);
  expect(host.textContent).toBe('Replacement ready');
  slot.dispose();
});
