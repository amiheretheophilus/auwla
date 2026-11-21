import { waitFor, spyOnAccessor } from '../../../test-support/helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createScrollCoordinator } from '../src/scroll';
import { createRouteRuntime } from '../src/runtime-full';
import { createMemoryRouteHistory } from '../src/history';

describe('scroll restoration coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  /** What an earlier document stored: `[key, x, y]` entries, oldest first. */
  function seed(entries: Array<[string, number, number]>) {
    sessionStorage.setItem('__mmd_scroll#positions', JSON.stringify(entries));
  }

  function stored(): Array<[string, number, number]> {
    return JSON.parse(sessionStorage.getItem('__mmd_scroll#positions') ?? '[]');
  }

  function deferredFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id);
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    return {
      request, cancel, scrollTo,
      flush() {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(0);
      },
    };
  }

  it('cancels an obsolete restore when another destination replaces it', () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/old'), 'push', 'old');
    coordinator.restore(new URL('http://localhost/new'), 'replace', 'new');
    frames.flush();
    expect(frames.cancel).toHaveBeenCalled();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('waits for destination readiness and ignores a superseded readiness signal', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    let ready!: () => void;
    const promise = new Promise<void>(resolve => { ready = resolve; });
    coordinator.restore(new URL('http://localhost/slow'), 'push', 'slow', promise);
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.restore(new URL('http://localhost/new'), 'replace', 'new');
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('restores only after the readiness signal resolves', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    let ready!: () => void;
    coordinator.restore(new URL('http://localhost/ready'), 'push', 'ready',
      new Promise<void>(resolve => { ready = resolve; }));
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 0);
    coordinator.dispose();
  });

  it('does not restore a destination whose readiness fails', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/failed'), 'push', 'failed',
      Promise.reject(new Error('failed mount')));
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('does not overwrite a saved destination offset with old DOM scroll while awaiting readiness', async () => {
    const frames = deferredFrames();
    spyOnAccessor(window, 'scrollY', 'get').mockReturnValue(10);
    seed([['waiting', 0, 750]]);
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    let ready!: () => void;
    coordinator.restore(new URL('http://localhost/waiting'), 'pop', 'waiting',
      new Promise<void>(resolve => { ready = resolve; }));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));
    coordinator.capture('waiting');
    frames.flush();
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 750);
    coordinator.dispose();
  });

  it('keeps positions in memory while navigating, and stores them when the page is hidden', () => {
    // Storage calls are synchronous, so scrolling and leaving entries never make them.
    const frames = deferredFrames();
    const position = spyOnAccessor(window, 'scrollY', 'get').mockReturnValue(300);
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    coordinator.restore(new URL('http://localhost/feed'), 'load', 'feed');
    for (let index = 0; index < 5; index++) {
      window.dispatchEvent(new Event('scroll'));
      frames.flush();
    }
    coordinator.capture('feed');
    coordinator.restore(new URL('http://localhost/other'), 'push', 'other');
    frames.flush();
    expect(sessionStorage.length).toBe(0);

    position.mockReturnValue(450);
    window.dispatchEvent(new Event('pagehide'));
    expect(stored()).toEqual([['feed', 0, 300], ['other', 0, 450]]);

    // A hidden tab may be discarded without a pagehide, so hiding it stores them too.
    position.mockReturnValue(520);
    const visibility = spyOnAccessor(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    expect(stored()).toEqual([['feed', 0, 300], ['other', 0, 520]]);

    // Disposed with nothing saved since, there is nothing to write.
    sessionStorage.clear();
    coordinator.dispose();
    expect(sessionStorage.length).toBe(0);
  });

  it('restores an entry left inside the app after the document reloads', () => {
    // Only the entry shown is saved when the page hides; the others were saved when left, and
    // the one write must keep them, or back after a reload would open them at the top.
    const frames = deferredFrames();
    const position = spyOnAccessor(window, 'scrollY', 'get').mockReturnValue(640);
    const before = createScrollCoordinator();
    before.connect();
    before.restore(new URL('http://localhost/list'), 'load', 'list');
    before.capture('list');
    before.restore(new URL('http://localhost/item'), 'push', 'item');
    frames.flush();
    position.mockReturnValue(90);
    window.dispatchEvent(new Event('pagehide'));
    before.dispose();

    frames.scrollTo.mockClear();
    const after = createScrollCoordinator();
    after.connect();
    after.restore(new URL('http://localhost/item'), 'load', 'item');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 90);
    after.restore(new URL('http://localhost/list'), 'pop', 'list');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 640);
    after.dispose();
  });

  it('bounds stored positions, keeping the most recently saved', () => {
    deferredFrames();
    spyOnAccessor(window, 'scrollY', 'get').mockReturnValue(10);
    const coordinator = createScrollCoordinator();
    for (let index = 0; index < 105; index++) coordinator.capture(`entry-${index}`);
    // Saved again, an old entry is the newest and outlives those saved after it the first time.
    coordinator.capture('entry-3');
    // Not connected, so disposing writes them, as for a runtime replaced in the same document.
    coordinator.dispose();
    const keys = stored().map(([key]) => key);
    expect(keys).toHaveLength(100);
    expect(keys).not.toContain('entry-0');
    expect(keys).not.toContain('entry-5');
    expect(keys.at(-1)).toBe('entry-3');

    // A reloaded document's offsets are newer than those it read back.
    const reloaded = createScrollCoordinator();
    reloaded.capture('entry-105');
    reloaded.dispose();
    const after = stored().map(([key]) => key);
    expect(after).toHaveLength(100);
    expect(after).not.toContain('entry-6');
    expect(after.at(-1)).toBe('entry-105');
  });

  it('keeps load and replace positions unchanged when there is no hash', () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/load'), 'load', 'load');
    coordinator.restore(new URL('http://localhost/replace'), 'replace', 'replace');
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('restores the offset an entry saved when it was hidden after a reload of that entry', () => {
    const frames = deferredFrames();
    const position = spyOnAccessor(window, 'scrollY', 'get').mockReturnValue(0);

    // The page is open and scrolled; reloading hides it, which stores the offset.
    const before = createScrollCoordinator();
    before.connect();
    before.restore(new URL('http://localhost/signals'), 'load', 'entry');
    frames.flush();
    position.mockReturnValue(1240);
    window.dispatchEvent(new Event('pagehide'));
    before.dispose();

    // The reloaded document has 'manual' restoration, so the browser leaves it at the top.
    frames.scrollTo.mockClear();
    position.mockReturnValue(0);
    const after = createScrollCoordinator();
    after.connect();
    after.restore(new URL('http://localhost/signals#plans'), 'load', 'entry');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 1240);

    // A fresh visit is a new entry: nothing saved, so the position is left alone.
    frames.scrollTo.mockClear();
    after.restore(new URL('http://localhost/signals'), 'load', 'fresh-entry');
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    after.dispose();
  });

  it('cancels a delayed hash observer when another navigation wins', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/old#old-target'), 'push', 'old-target');
    frames.flush();
    coordinator.restore(new URL('http://localhost/new'), 'push', 'new');
    frames.flush();
    const target = document.createElement('h2');
    target.id = 'old-target';
    const intoView = vi.spyOn(target, 'scrollIntoView');
    document.body.append(target);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(intoView).not.toHaveBeenCalled();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 0);
    coordinator.dispose();
  });

  it('prefers saved history position over the URL hash on back/forward', () => {
    const frames = deferredFrames();
    const target = document.createElement('h2');
    target.id = 'saved';
    document.body.append(target);
    const intoView = vi.spyOn(target, 'scrollIntoView');
    seed([['saved', 12, 820]]);
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/docs#saved'), 'pop', 'saved');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(12, 820);
    expect(intoView).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('finds a hash target inserted after more than two frames', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/docs#late'), 'push', 'late');
    frames.flush();
    frames.flush();
    frames.flush();
    const target = document.createElement('h2');
    target.id = 'late';
    const intoView = vi.spyOn(target, 'scrollIntoView');
    document.body.append(target);
    await waitFor(() => expect(intoView).toHaveBeenCalledTimes(1));
    coordinator.dispose();
  });

  it('cancels delayed hash discovery when the user starts scrolling', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    coordinator.restore(new URL('http://localhost/docs#cancelled'), 'push', 'cancelled');
    frames.flush();
    window.dispatchEvent(new WheelEvent('wheel'));
    const target = document.createElement('h2');
    target.id = 'cancelled';
    const intoView = vi.spyOn(target, 'scrollIntoView');
    document.body.append(target);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(intoView).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('keeps restoring through sideways wheel events, such as a touchpad swipe back', async () => {
    // The swipe that goes back sends horizontal wheel events, and some arrive after the entry
    // changes. They are not the person scrolling the page, so the saved offset still applies.
    const frames = deferredFrames();
    seed([['swiped', 0, 900]]);
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    let ready!: () => void;
    coordinator.restore(new URL('http://localhost/list'), 'pop', 'swiped',
      new Promise<void>(resolve => { ready = resolve; }));
    window.dispatchEvent(new WheelEvent('wheel', { deltaX: -120, deltaY: 4 }));
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 900);

    // Scrolling the page itself still wins over a restore that has not happened yet.
    coordinator.restore(new URL('http://localhost/list'), 'pop', 'swiped', new Promise<void>(resolve => { ready = resolve; }));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('handles malformed percent escapes and named anchors without CSS.escape', () => {
    const frames = deferredFrames();
    const target = document.createElement('a');
    target.setAttribute('name', '%broken');
    document.body.append(target);
    const intoView = vi.spyOn(target, 'scrollIntoView');
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/docs#%broken'), 'push', 'broken');
    expect(() => frames.flush()).not.toThrow();
    expect(intoView).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('ignores invalid stored coordinates and falls back to the top', () => {
    const frames = deferredFrames();
    sessionStorage.setItem('__mmd_scroll#positions', '[["invalid",null,"820"],"junk",["other",0]]');
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/invalid'), 'pop', 'invalid');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 0);
    coordinator.dispose();
  });

  it('dispose releases listeners, cancels queued work and restores browser policy', () => {
    const frames = deferredFrames();
    const previous = history.scrollRestoration;
    const remove = vi.spyOn(window, 'removeEventListener');
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    coordinator.restore(new URL('http://localhost/disposed'), 'push', 'disposed');
    coordinator.dispose();
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe(previous);
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('uses memory history entry keys for back/forward scroll snapshots', () => {
    const frames = deferredFrames();
    const position = spyOnAccessor(window, 'scrollY', 'get').mockReturnValue(640);
    const history = createMemoryRouteHistory({ initialEntries: ['/first'] });
    const runtime = createRouteRuntime({ routeHistory: history, environment: {} });
    runtime.connect();
    runtime.navigate('/second');
    frames.flush();
    position.mockReturnValue(210);
    runtime.back();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 640);
    runtime.forward();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 210);
    // Navigating keeps offsets in memory; storage is written when the page hides.
    expect(sessionStorage.length).toBe(0);
    runtime.dispose();
    history.destroy();
  });

  it('records scroll position and restores it on pop navigation', async () => {
    let scrollX = 0;
    let scrollY = 0;
    const scrollTo = vi.fn((x: number, y: number) => {
      scrollX = x;
      scrollY = y;
    });

    const mockWindow = {
      get scrollX() { return scrollX; },
      get scrollY() { return scrollY; },
      scrollTo,
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const coordinator = createScrollCoordinator({ window: mockWindow });
    const disconnect = coordinator.connect();

    // 1. Initial page (Key 1) at (0, 0)
    coordinator.restore(new URL('http://localhost/page1'), 'load', 'key_1');

    // 2. User scrolls down to (0, 1420)
    scrollX = 0;
    scrollY = 1420;
    coordinator.capture('key_1');

    // 3. Navigate to Page 2 (Push) -> resets scroll to (0, 0)
    coordinator.restore(new URL('http://localhost/page2'), 'push', 'key_2');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    // 4. Navigate back to Page 1 (Pop) -> restores (0, 1420)
    coordinator.restore(new URL('http://localhost/page1'), 'pop', 'key_1');
    expect(scrollTo).toHaveBeenCalledWith(0, 1420);

    disconnect();
    coordinator.dispose();
  });

  it('opens a page reached by a link where it was last left', () => {
    let scrollY = 0;
    const scrollTo = vi.fn((_x: number, y: number) => { scrollY = y; });
    const mockWindow = {
      scrollX: 0,
      get scrollY() { return scrollY; },
      scrollTo,
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const coordinator = createScrollCoordinator({ window: mockWindow });

    // The list is scrolled, then left for another section through a link.
    coordinator.restore(new URL('http://localhost/desk'), 'load', 'k1');
    scrollY = 880;
    coordinator.capture('k1');
    coordinator.restore(new URL('http://localhost/desk/payments'), 'push', 'k2');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    // The navigation's link back to the list opens it where it was, as a new entry.
    scrollY = 120;
    coordinator.capture('k2');
    coordinator.restore(new URL('http://localhost/desk'), 'push', 'k3');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 880);
    // The runtime restores a pushed entry again once the browser commits its real key.
    coordinator.restore(new URL('http://localhost/desk'), 'push', 'k3-committed');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 880);

    // A link to the page already shown goes to the top.
    coordinator.capture('k3-committed');
    coordinator.restore(new URL('http://localhost/desk'), 'push', 'k4');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    // So does a page not visited yet, and the same path with another query.
    coordinator.capture('k4');
    coordinator.restore(new URL('http://localhost/desk?status=posted'), 'push', 'k5');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    // The section left earlier still opens where it was.
    coordinator.restore(new URL('http://localhost/desk/payments'), 'push', 'k6');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 120);
    coordinator.dispose();
  });

  it('scrolls hash targets into view with fallback retry', () => {
    const scrollIntoView = vi.fn();
    const mockElement = { scrollIntoView } as unknown as Element;

    const mockDoc = {
      getElementById: vi.fn((id: string) => (id === 'faq' ? mockElement : null)),
      querySelector: vi.fn(() => null),
    } as unknown as Document;

    const mockWindow = {
      scrollX: 0,
      scrollY: 0,
      scrollTo: vi.fn(),
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const coordinator = createScrollCoordinator({
      window: mockWindow,
      document: mockDoc,
    });

    // Hash navigation (push to /docs#faq)
    coordinator.restore(new URL('http://localhost/docs#faq'), 'push', 'key_faq');
    expect(mockDoc.getElementById).toHaveBeenCalledWith('faq');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

    coordinator.dispose();
  });

  it('integrates transparently with createRouteRuntime with zero state pollution', () => {
    const stateHistory: Array<{ state: unknown; url: string }> = [];
    const mockHistory = {
      scrollRestoration: 'auto' as ScrollRestoration,
      get state() {
        return stateHistory.at(-1)?.state ?? null;
      },
      pushState: vi.fn((state: unknown, _title: string, url: string) => {
        stateHistory.push({ state, url });
      }),
      replaceState: vi.fn((state: unknown, _title: string, url: string) => {
        if (stateHistory.length === 0) stateHistory.push({ state, url });
        else stateHistory[stateHistory.length - 1] = { state, url };
      }),
    } as unknown as History;

    const mockWindow = {
      scrollX: 0,
      scrollY: 0,
      scrollTo: vi.fn(),
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      history: mockHistory,
      location: { href: 'http://localhost/' },
    } as unknown as Window;

    const runtime = createRouteRuntime({
      location: mockWindow.location as unknown as Location,
      history: mockHistory,
    });

    const disconnect = runtime.connect();

    // ScrollRestoration set to manual automatically
    expect(mockHistory.scrollRestoration).toBe('manual');

    // 1. Navigate with custom object state
    runtime.navigate('/settings', { state: { tab: 'security', filter: 'active' } });

    // User-facing route.state is pure and clean (zero __mmd_key leakage)
    expect(runtime.route.state).toEqual({ tab: 'security', filter: 'active' });

    // 2. Navigate with primitive state
    runtime.navigate('/count', { state: 42 });
    expect(runtime.route.state).toBe(42);

    disconnect();
    runtime.dispose();
  });
});
