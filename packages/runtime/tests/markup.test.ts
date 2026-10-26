import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createApplicationRuntime, runWithApplicationRuntime, runWithRenderEnvironment } from '../src/kernel';
import { cloneTemplate, createTemplateCache } from '../src/markup';
import type { DocumentLike } from '../src/environment';

const document = new Window().document as unknown as Document;

function build(counter: { builds: number }) {
  return (target: DocumentLike, namespace: 'html' | 'svg') => {
    counter.builds++;
    const item = namespace === 'svg'
      ? target.createElementNS('http://www.w3.org/2000/svg', 'g')
      : target.createElement('li');
    // Adjacent text slots stay separate nodes, as a parsed template would not keep them.
    item.append(target.createTextNode(''), target.createTextNode(': '), target.createTextNode(''));
    return item;
  };
}

it('builds a template once per document and namespace and clones it with separate text nodes', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => runWithRenderEnvironment({ document: document as unknown as DocumentLike }, () => {
    const counter = { builds: 0 };
    const cache = createTemplateCache();
    const first = cloneTemplate(cache, undefined, build(counter)) as Element;
    const second = cloneTemplate(cache, 'html', build(counter)) as Element;
    expect(counter.builds).toBe(1);
    expect(first).not.toBe(second);
    expect(first.childNodes).toHaveLength(3);
    expect(first.localName).toBe('li');
    const svg = cloneTemplate(cache, 'svg', build(counter)) as Element;
    expect(counter.builds).toBe(2);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    const other = new Window().document as unknown as DocumentLike;
    runWithRenderEnvironment({ document: other }, () => {
      const clone = cloneTemplate(cache, undefined, build(counter)) as Node;
      expect(clone.ownerDocument).toBe(other as unknown as Document);
    });
    expect(counter.builds).toBe(3);
  }));
});

it('leaves hydration and server documents to the general creation', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const counter = { builds: 0 };
    const cache = createTemplateCache();
    const hydration = {} as never;
    runWithRenderEnvironment({ document: document as unknown as DocumentLike, hydration }, () => {
      expect(cloneTemplate(cache, undefined, build(counter))).toBeNull();
    });
    const server = Object.assign(Object.create(document), { materializeMarkup: () => [] }) as DocumentLike;
    runWithRenderEnvironment({ document: server, hydration: undefined }, () => {
      expect(cloneTemplate(cache, undefined, build(counter))).toBeNull();
    });
    expect(counter.builds).toBe(0);
  });
});
