import { expect, it } from 'bun:test';
import { installHydrationRuntime } from '../packages/runtime/src/mount';
import { hydrateList } from '../packages/runtime/src/hydration-list';
import { claimHydrationRoot, HydrationDocument } from '../packages/runtime/src/hydration';

it('retains installed list adoption when a later program only needs ordinary nodes', () => {
  // The bridge is realm-wide: put back the hydrate a program loaded earlier in
  // this process installed, so later files do not mount through the stub.
  const realm = globalThis as unknown as Record<symbol, { hydrate?: unknown; capabilities?: Record<string, unknown> } | undefined>;
  const earlier = realm[Symbol.for('memoized-dom:hydration-runtime-bridge')];
  const previous = earlier?.hydrate;
  const previousCapabilities = earlier?.capabilities === undefined ? undefined : { ...earlier.capabilities };
  const unused = () => { throw new Error('This test adopts directly'); };
  const first = installHydrationRuntime(unused, { list: hydrateList });
  const second = installHydrationRuntime(unused, {});
  expect(second).toBe(first);
  const host=document.createElement('div');
  host.innerHTML='<!--mmd:r:App--><ul><!--mmd:l:Rows--><!--mmd:w:Rows:n:0--><li>one</li><!--/mmd--></ul><!--/mmd-->';
  const row=host.querySelector('li');
  const documentPlan=new HydrationDocument(document,claimHydrationRoot(host,'App'),second);
  try {
    const list=documentPlan.claimList(host.querySelector('ul')!,'Rows');
    const adopted=list.adoptRow(0,'n:0',()=>{
      const text=documentPlan.createTextNode('one');
      const element=documentPlan.createElement('li');element.appendChild(text);return element;
    });
    expect(adopted.value).toBe(row);list.finish();
    expect(documentPlan.createElement('ul')).toBe(host.querySelector('ul'));
    documentPlan.expectDone();
  } finally {
    documentPlan.finishHydration();
    const bridge = realm[Symbol.for('memoized-dom:hydration-runtime-bridge')]!;
    if (previous !== undefined) bridge.hydrate = previous;
    if (previousCapabilities !== undefined) {
      for (const key of Object.keys(bridge.capabilities!)) delete bridge.capabilities![key];
      Object.assign(bridge.capabilities!, previousCapabilities);
    }
  }
});
