import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createApplicationRuntime, runWithApplicationRuntime, runWithRenderEnvironment } from '../src/kernel';
import { cloneTemplate, createTemplateCache, type TemplateNode } from '../src/markup';
import type { DocumentLike } from '../src/environment';

const document = new Window().document as unknown as Document;
const SVG = 'http://www.w3.org/2000/svg';
const HTML = 'http://www.w3.org/1999/xhtml';

/** Counts builds through the document's element creation. */
function counting(target: Document) {
  const counter = { builds: 0 };
  const proxy = Object.create(target, {
    createDocumentFragment: { value: () => { counter.builds++; return target.createDocumentFragment(); } },
  }) as DocumentLike;
  return { counter, proxy };
}

// Adjacent text slots stay separate nodes, as a parsed template would not keep them.
const item: TemplateNode[] = [null, ['li', ['class', 'row'], '', ': ', ''], 'after'];

it('builds a template once per document and namespace and clones it with separate text nodes', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const { counter, proxy } = counting(document);
    const cache = createTemplateCache(item);
    runWithRenderEnvironment({ document: proxy }, () => {
      const first = cloneTemplate(cache) as DocumentFragment;
      const second = cloneTemplate(cache, 'html') as DocumentFragment;
      expect(counter.builds).toBe(1);
      expect(first).not.toBe(second);
      expect([...first.childNodes].map((node) => node.nodeType)).toEqual([8, 1, 3]);
      const li = first.childNodes[1] as Element;
      expect(li.localName).toBe('li');
      expect(li.getAttribute('class')).toBe('row');
      expect(li.childNodes).toHaveLength(3);
      const svg = cloneTemplate(cache, 'svg') as DocumentFragment;
      expect(counter.builds).toBe(2);
      expect((svg.childNodes[1] as Element).namespaceURI).toBe(SVG);
    });
    const other = new Window().document as unknown as DocumentLike;
    runWithRenderEnvironment({ document: other }, () => {
      const clone = cloneTemplate(cache) as Node;
      expect(clone.ownerDocument).toBe(other as unknown as Document);
    });
  });
});

it('follows the destination namespace until foreignObject, and an svg tag starts SVG', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => runWithRenderEnvironment({ document: document as unknown as DocumentLike }, () => {
    const cache = createTemplateCache([
      ['g', 0, ['foreignObject', 0, ['b', 0, ['svg', 0, ['circle', ['r', '1']]]]]],
    ]);
    for (const namespace of ['html', 'svg'] as const) {
      const root = cloneTemplate(cache, namespace) as Element;
      const outer = namespace === 'svg' ? SVG : HTML;
      expect(root.namespaceURI).toBe(outer);
      expect(root.firstElementChild!.namespaceURI).toBe(outer);
      expect(root.querySelector('b')!.namespaceURI).toBe(HTML);
      expect(root.querySelector('svg')!.namespaceURI).toBe(SVG);
      expect(root.querySelector('circle')!.namespaceURI).toBe(SVG);
      expect(root.querySelector('circle')!.getAttribute('r')).toBe('1');
    }
  }));
});

it('refuses hydration, which compiler-next does not emit yet', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const cache = createTemplateCache([['p', 0]]);
    runWithRenderEnvironment({ document: document as unknown as DocumentLike, hydration: {} as never }, () => {
      expect(() => cloneTemplate(cache)).toThrow('cannot hydrate');
    });
  });
});
