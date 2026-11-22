/**
 * A progressive server page in a compiled child site (`render-value.ts`, `mountPage`). These ran
 * on the old compiler's content region until it went (2026-11-18).
 */
import { afterEach, expect, it } from 'bun:test';
import { acceptPageContent, type PageContent } from '../packages/runtime/src/page-content';
import { createValueSlot } from '../packages/runtime/src/render-value';
import { registerEntity, unregisterSubtree } from '../packages/runtime/src/kernel';
import { adoptRoot } from '../packages/runtime/src/adoption';

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

it("adopts the server's page element, so what the user typed in it survives hydration", () => {
  // As the server numbers it (`content-region.ts`): the slot's region takes 0 and the page's HTML
  // 0v:0. The [0] inside is the page's own render's number, which the program's must not meet.
  // Before 2026-11-22 the page was not numbered: adoption dropped it and parsed the HTML again.
  const page = '<div data-mmd-page-render="first"><input value="initial"><!--[0--><b>own</b></div>';
  document.body.innerHTML = `<main><!--open--><!--mmd:page--><!--[0v:0-->${page}<!--end--></main>`;
  const host = document.querySelector('main')!;
  const [open, end] = [host.firstChild!, host.lastChild!];
  const serverPage = host.querySelector('div')!, input = host.querySelector('input')!;
  input.value = 'typed';
  const entity = { id: 'one', parent: null, render() {} };
  registerEntity(entity);
  const mismatches: unknown[] = [];

  const fragment = adoptRoot(open, end, () => {
    const fragment = document.createDocumentFragment();
    const text = document.createTextNode('');
    fragment.append(text);
    createValueSlot(text, { id: 'one', entity, batch: null })
      .write(acceptPageContent({ $mmd: 'page', version: 1, id: 'board', html: page, progress: { id: 'first', sequence: 1, complete: false, regions: [] } }));
    return fragment;
  }, (error) => mismatches.push(error));
  host.append(fragment);

  expect(mismatches).toEqual([]);
  expect(host.querySelector('div')).toBe(serverPage);
  expect(host.querySelector('input')).toBe(input);
  expect(input.value).toBe('typed');
  expect(host.querySelector('b')?.previousSibling?.nodeValue).toBe('[0');
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
