import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createApplicationRuntime, runWithApplicationRuntime, runWithRenderEnvironment } from '../src/kernel';
import { cloneTemplate, createTemplateCache, type TemplateNode } from '../src/markup';
import type { DocumentLike } from '../src/environment';
import { adoptRoot, numberedDocument, serverCreations } from '../src/adoption';

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

// `adoption.ts`: a server numbers each clone; a browser takes the server's node when it fits.
it('numbers clones, root by root for several roots, and does not count building the template', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const ids = new WeakMap<object, string>();
    const creations = serverCreations(ids);
    const one = createTemplateCache([['p', 0, ['b', 0, 'x']]]);
    const two = createTemplateCache([['i', 0], ['u', 0]]);
    runWithRenderEnvironment({ document: numberedDocument(document as unknown as DocumentLike, creations), creations }, () => {
      const first = cloneTemplate(one);
      const pair = cloneTemplate(two);
      const again = cloneTemplate(one);
      expect(ids.get(first)).toBe('0');
      expect([...pair.childNodes].map((node) => ids.get(node))).toEqual(['1.0', '1.1']);
      expect(ids.get(again)).toBe('2');
      expect(ids.get(first.firstChild!)).toBeUndefined();
    });
  });
});

it('takes a server node that fits, resetting its static parts, and makes a new one otherwise', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const host = document.createElement('div');
    host.innerHTML = '<!--mmd:r:App--><!--[0--><p class="stale" title="t">old<!--extra--></p><!--[1--><section></section><!--/mmd-->';
    const server = host.querySelector('p');
    const cache = createTemplateCache([['p', 0, 'x', null]]);
    runWithRenderEnvironment({ document: document as unknown as DocumentLike }, () => {
      adoptRoot(host.firstChild!, host.lastChild!, () => {
        const taken = cloneTemplate(cache) as Element;
        expect(taken).toBe(server);
        expect(taken.attributes.length).toBe(0);
        expect([...taken.childNodes].map((node) => [node.nodeType, node.textContent])).toEqual([[3, 'x'], [8, '']]);
        // Creation 1 was a `section` on the server; this template wants a `p`.
        const fresh = cloneTemplate(cache);
        expect(fresh).not.toBe(host.querySelector('section'));
        expect((fresh as Element).localName).toBe('p');
      });
    });
    expect(host.childNodes.length).toBe(0);
  });
});

it('keeps a scrolled element where it was while its nodes are detached and taken back', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = '<!--mmd:r:App--><!--[0--><ul><li>a</li></ul><!--/mmd-->';
    const list = host.querySelector('ul')!;
    list.scrollTop = 40;
    const cache = createTemplateCache([['ul', 0, ['li', 0, 'a']]]);
    runWithRenderEnvironment({ document: document as unknown as DocumentLike }, () => {
      adoptRoot(host.firstChild!, host.lastChild!, () => host.append(cloneTemplate(cache)));
    });
    expect(host.querySelector('ul')).toBe(list);
    expect(list.scrollTop).toBe(40);
    host.remove();
  });
});

/**
 * Happy DOM runs no CSS animations, so `getAnimations` plays the browser's part: an element
 * detached and put back gets new animation objects that start again from 0.
 */
function fakeAnimations(target: Document) {
  type Fake = { animationName: string; timeline: unknown; effect: { target: Element; pseudoElement: string | null }; currentTime: number };
  const scrollTimeline = {};
  let playing: Fake[] = [];
  const play = (element: Element, animationName: string, currentTime: number, pseudoElement: string | null = null, timeline: unknown = target.timeline) => {
    playing.push({ animationName, timeline, effect: { target: element, pseudoElement }, currentTime });
  };
  const restartAll = () => {
    playing = playing.map((animation) => ({ ...animation, effect: { ...animation.effect }, currentTime: 0 }));
  };
  Object.defineProperty(target, 'getAnimations', { configurable: true, value: () => playing });
  return {
    play, restartAll, scrollTimeline,
    timeOf: (element: Element, name: string, pseudo: string | null = null) =>
      playing.find((animation) => animation.effect.target === element && animation.animationName === name && animation.effect.pseudoElement === pseudo)!.currentTime,
    uninstall: () => { delete (target as unknown as Record<string, unknown>).getAnimations; },
  };
}

it('keeps CSS animations where they were while their elements are detached and taken back', () => {
  runWithApplicationRuntime(createApplicationRuntime(), () => {
    const host = document.createElement('div');
    const outside = document.createElement('aside');
    document.body.append(host, outside);
    host.innerHTML = '<!--mmd:r:App--><!--[0--><h1><span>a</span></h1><!--/mmd-->';
    const heading = host.querySelector('h1')!;
    const word = host.querySelector('span')!;
    const animations = fakeAnimations(document);
    animations.play(word, 'rise', 400);
    animations.play(heading, 'pulse', 900, '::before');
    animations.play(heading, 'drift', 0.5, null, animations.scrollTimeline);
    animations.play(outside, 'spin', 300);

    const cache = createTemplateCache([['h1', 0, ['span', 0, 'a']]]);
    runWithRenderEnvironment({ document: document as unknown as DocumentLike }, () => {
      adoptRoot(host.firstChild!, host.lastChild!, () => {
        host.append(cloneTemplate(cache));
        // The browser restarts the animations of every element that was put back.
        animations.restartAll();
      });
    });

    expect(host.querySelector('span')).toBe(word);
    expect(animations.timeOf(word, 'rise')).toBe(400);
    expect(animations.timeOf(heading, 'pulse', '::before')).toBe(900);
    // A scroll timeline follows the scroll, and an element outside the root was never detached.
    expect(animations.timeOf(heading, 'drift')).toBe(0);
    expect(animations.timeOf(outside, 'spin')).toBe(0);
    animations.uninstall();
    host.remove();
    outside.remove();
  });
});
