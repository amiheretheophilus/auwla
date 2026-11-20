/**
 * `route.pending`, `route.next`, and the attributes CSS uses while a navigation waits for its page
 * (`src/waiting.ts`).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createRouteRuntime, registerRoutedPreparation } from '../src/internal';

/** A microtask later, when a change of the router's preparation is published. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-navigating');
});

describe('a navigation waiting for its page', () => {
  it('is pending, with the page it loads, until that page shows', async () => {
    let release!: (value: string) => void;
    registerRoutedPreparation({
      id: 'waiting-report', server: false,
      prepare: () => new Promise<string>((resolve) => { release = resolve; }),
    });
    const runtime = createRouteRuntime({ environment: {}, routes: [
      { id: 'home', pattern: '/' },
      { id: 'report', pattern: '/report', metadata: { preparations: ['waiting-report'] } },
    ] });
    const seen: string[] = [];
    runtime.subscribeWaiting(() => seen.push(runtime.route.next?.pathname ?? 'none'));
    try {
      expect(runtime.route.pending).toBe(false);
      expect(runtime.route.next).toBeNull();

      const result = runtime.navigate('/report');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await settled();
      expect(runtime.route.pending).toBe(true);
      expect(runtime.route.next?.pathname).toBe('/report');
      // The page being left stays the route until the new one shows.
      expect(runtime.route.pathname).toBe('/');

      release('report data');
      await result.finished;
      await settled();
      expect(runtime.route.pending).toBe(false);
      expect(runtime.route.next).toBeNull();
      expect(runtime.route.pathname).toBe('/report');
      expect(seen).toEqual(['/report', 'none']);
    } finally {
      runtime.dispose();
    }
  });

  it('is never pending for a navigation with nothing to wait for', async () => {
    const runtime = createRouteRuntime({ environment: {}, routes: [
      { id: 'home', pattern: '/' },
      { id: 'about', pattern: '/about' },
    ] });
    let calls = 0;
    runtime.subscribeWaiting(() => calls++);
    try {
      expect(runtime.navigate('/about').status).toBe('completed');
      await settled();
      expect(runtime.route.pending).toBe(false);
      expect(calls).toBe(0);
    } finally {
      runtime.dispose();
    }
  });

  it('follows a newer navigation, and stops when that one needs no wait', async () => {
    registerRoutedPreparation({
      id: 'waiting-slow', server: false,
      prepare: () => new Promise<string>(() => {}),
    });
    const runtime = createRouteRuntime({ environment: {}, routes: [
      { id: 'home', pattern: '/' },
      { id: 'slow', pattern: '/slow/:id', metadata: { preparations: ['waiting-slow'] } },
      { id: 'about', pattern: '/about' },
    ] });
    try {
      const first = runtime.navigate('/slow/1');
      if (first.status !== 'preparing') throw new Error('Expected preparation');
      first.finished.catch(() => {});
      await settled();
      expect(runtime.route.next?.pathname).toBe('/slow/1');

      const second = runtime.navigate('/slow/2');
      if (second.status !== 'preparing') throw new Error('Expected preparation');
      second.finished.catch(() => {});
      await settled();
      expect(runtime.route.next?.pathname).toBe('/slow/2');

      expect(runtime.navigate('/about').status).toBe('completed');
      await settled();
      expect(runtime.route.pending).toBe(false);
      expect(runtime.route.pathname).toBe('/about');
    } finally {
      runtime.dispose();
    }
  });

  it('marks the page and each link to the page being loaded, and clears them after', async () => {
    let release!: (value: string) => void;
    registerRoutedPreparation({
      id: 'waiting-marked', server: false,
      prepare: () => new Promise<string>((resolve) => { release = resolve; }),
    });
    const runtime = createRouteRuntime({ environment: {}, routes: [
      { id: 'home', pattern: '/' },
      { id: 'payments', pattern: '/payments', metadata: { preparations: ['waiting-marked'] } },
    ] });
    const disconnect = runtime.connect();
    const origin = new URL(runtime.route.href).origin;
    document.body.innerHTML = `
      <a id="nav" href="${origin}/payments">Payments</a>
      <a id="card" href="${origin}/payments#latest">Latest payment</a>
      <a id="other" href="${origin}/signals">Signals</a>
      <a id="own" href="${origin}/payments" aria-busy="false">Authored</a>`;
    const busy = (id: string) => document.getElementById(id)!.getAttribute('aria-busy');
    try {
      const result = runtime.navigate('/payments');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await settled();
      expect(document.documentElement.hasAttribute('data-navigating')).toBe(true);
      expect(busy('nav')).toBe('true');
      // A hash only scrolls the same page.
      expect(busy('card')).toBe('true');
      expect(busy('other')).toBeNull();
      // An author's own value is left alone.
      expect(busy('own')).toBe('false');

      release('payments');
      await result.finished;
      await settled();
      expect(document.documentElement.hasAttribute('data-navigating')).toBe(false);
      expect(busy('nav')).toBeNull();
      expect(busy('card')).toBeNull();
      expect(busy('own')).toBe('false');
    } finally {
      disconnect();
      runtime.dispose();
    }
  });

  it('touches no document when it drives no page', async () => {
    let release!: (value: string) => void;
    registerRoutedPreparation({
      id: 'waiting-unconnected', server: false,
      prepare: () => new Promise<string>((resolve) => { release = resolve; }),
    });
    const runtime = createRouteRuntime({ environment: {}, routes: [
      { id: 'home', pattern: '/' },
      { id: 'quiet', pattern: '/quiet', metadata: { preparations: ['waiting-unconnected'] } },
    ] });
    try {
      const result = runtime.navigate('/quiet');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await settled();
      expect(runtime.route.pending).toBe(true);
      expect(document.documentElement.hasAttribute('data-navigating')).toBe(false);
      release('quiet');
      await result.finished;
    } finally {
      runtime.dispose();
    }
  });
});
