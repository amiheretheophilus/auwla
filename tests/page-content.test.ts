/**
 * Server page content in a compiled child site (`render-value.ts`, `mountPage`). These ran on the
 * old compiler's content region until it went (2026-11-18); compiler-next's value slot shows the
 * same content through `mountPage`.
 */
import { afterEach, expect, it } from 'bun:test';
import { acceptPageContent, registerPageBinder, type PageContent } from '../packages/runtime/src/page-content';
import { createValueSlot } from '../packages/runtime/src/render-value';
import { registerEntity, unregisterSubtree } from '../packages/runtime/src/kernel';

afterEach(() => { unregisterSubtree('owner'); document.body.replaceChildren(); });
const page = (html: string, id = 'page'): PageContent => acceptPageContent({ $mmd: 'page', version: 1, id, html });

/** A host element with a compiled child site, as a component's text slot is. */
function site() {
  const host = document.createElement('main');
  const text = document.createTextNode('');
  host.append(text);
  document.body.append(host);
  const entity = { id: 'owner', parent: null, render() {} };
  registerEntity(entity);
  return { host, slot: createValueSlot(text, { id: entity.id, entity, batch: null }) };
}

it('inserts server HTML without interpreting ordinary strings as HTML', () => {
  const { host, slot } = site();
  slot.write(page('<h1>Server</h1><p>Two roots</p>'));
  expect(host.querySelector('h1')?.textContent).toBe('Server');
  expect(host.querySelector('p')?.textContent).toBe('Two roots');
  const text = '<script>not HTML</script>';
  slot.write(text);
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toBe(text);
  slot.write(null);
  expect(host.textContent).toBe('');
  slot.dispose();
  expect(host.querySelector('h1, p')).toBeNull();
});

it('updates compatible binding inputs and drains replaced or unmounted bindings once', () => {
  const { host, slot } = site();
  let binds = 0, disposals = 0;
  registerPageBinder('test:page', (root, inputs) => {
    binds++; root.textContent = String(inputs[0]);
    return { update(next) { root.textContent = String(next[0]); }, dispose() { disposals++; } };
  });
  let value = acceptPageContent({ ...page('<section>Initial</section>'), binding: { key: 'test:page', inputs: ['first'] } });
  slot.write(value);
  const section = host.querySelector('section');
  value = acceptPageContent({ ...value, binding: { ...value.binding!, inputs: ['second'] } });
  slot.write(value);
  expect(host.querySelector('section')).toBe(section);
  expect(section?.textContent).toBe('second');
  expect(binds).toBe(1);
  value = acceptPageContent({ ...value, id: 'different' });
  slot.write(value);
  expect(binds).toBe(2);
  expect(disposals).toBe(1);
  slot.dispose();
  slot.dispose();
  expect(disposals).toBe(2);
});

it('fails closed and inserts nothing when a binding contract is unavailable', () => {
  const { host, slot } = site();
  expect(() => slot.write(acceptPageContent({ ...page('<p>Unsafe contract</p>'), binding: { key: 'missing', inputs: [] } })))
    .toThrow('binding contract');
  expect(host.querySelector('p')).toBeNull();
});

it('never interprets a page-shaped ordinary JSON payload as trusted HTML', () => {
  const { host, slot } = site();
  const forged = { $mmd: 'page', version: 1, id: 'forged', html: '<img src=x onerror="alert(1)">' };
  slot.write(forged);
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toBe('[object Object]');
  slot.dispose();
});
