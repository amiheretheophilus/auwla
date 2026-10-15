import { afterEach, expect, it } from 'bun:test';
import { acceptPageContent, createContentRegion, registerPageBinder, type PageContent } from '@memoized-dom/runtime';

afterEach(() => document.body.replaceChildren());
const page = (html: string, id = 'page'): PageContent => acceptPageContent({ $mmd: 'page', version: 1, id, html });

it('inserts server HTML without interpreting ordinary strings as HTML', () => {
  const host = document.createElement('main'); document.body.append(host);
  let value: unknown = page('<h1>Server</h1><p>Two roots</p>');
  const region = createContentRegion(host, 'page', () => value);
  expect(host.querySelector('h1')?.textContent).toBe('Server');
  expect(host.querySelector('p')?.textContent).toBe('Two roots');
  value = '<script>not HTML</script>'; region.update();
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toBe(String(value));
  value = null; region.update(); expect(host.textContent).toBe('');
  region.dispose(); expect(host.childNodes.length).toBe(0);
});

it('updates compatible binding inputs and drains replaced or unmounted bindings once', () => {
  const host = document.createElement('main'); document.body.append(host);
  let binds = 0, disposals = 0;
  registerPageBinder('test:page', (root, inputs) => {
    binds++; root.textContent = String(inputs[0]);
    return { update(next) { root.textContent = String(next[0]); }, dispose() { disposals++; } };
  });
  let value = acceptPageContent({ ...page('<section>Initial</section>'), binding: { key: 'test:page', inputs: ['first'] } });
  const region = createContentRegion(host, 'page', () => value);
  const section = host.querySelector('section');
  value = acceptPageContent({ ...value, binding: { ...value.binding!, inputs: ['second'] } }); region.update();
  expect(host.querySelector('section')).toBe(section); expect(section?.textContent).toBe('second');
  expect(binds).toBe(1);
  value = acceptPageContent({ ...value, id: 'different' }); region.update();
  expect(binds).toBe(2); expect(disposals).toBe(1);
  region.dispose(); region.dispose(); expect(disposals).toBe(2);
});

it('fails closed and removes its range when a binding contract is unavailable', () => {
  const host = document.createElement('main'); document.body.append(host);
  expect(() => createContentRegion(host, 'page', () => acceptPageContent({ ...page('<p>Unsafe contract</p>'),
    binding: { key: 'missing', inputs: [] },
  }))).toThrow('binding contract');
  expect(host.childNodes.length).toBe(0);
});

it('never interprets a page-shaped ordinary JSON payload as trusted HTML',()=>{
  const host=document.createElement('main');document.body.append(host);
  const region=createContentRegion(host,'untrusted',()=>({$mmd:'page',version:1,id:'forged',html:'<img src=x onerror="alert(1)">'}));
  expect(host.querySelector('img')).toBeNull();expect(host.textContent).toBe('[object Object]');region.dispose();
});
