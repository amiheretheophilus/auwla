/**
 * @memoized-dom/router — Deterministic scroll position restoration coordinator.
 *
 * Manages history-keyed scroll positions, hash navigation, and manual scroll
 * restoration across single-page transitions without exposing any extra
 * public API surface.
 */

export interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Every saved offset, as one JSON array of `[key, x, y]`, oldest first. It is read once, when a
 * reload or a return to the document first needs an offset, and written once, when the page is
 * hidden: navigating never touches storage, whose calls are synchronous.
 */
const SESSION_STORAGE_POSITIONS = '__mmd_scroll#positions';
const MAX_SAVED_POSITIONS = 100;

export interface ScrollCoordinatorOptions {
  readonly window?: Window;
  readonly document?: Document;
  readonly history?: History;
}

export interface ScrollCoordinator {
  /** Capture current viewport scroll offset for the specified history key. */
  capture(key?: string | null): void;
  /** Restore after optional renderer readiness; obsolete work is cancelled. */
  restore(
    url: URL,
    type: 'load' | 'push' | 'replace' | 'pop',
    key?: string | null,
    ready?: PromiseLike<void>,
  ): void;
  /** Cancel work belonging to an obsolete destination. */
  cancel(): void;
  /** Connect global scroll and navigation listeners. Returns a disconnect callback. */
  connect(): () => void;
  /** Clear in-memory snapshots and release listeners. */
  dispose(): void;
}

/** The offsets an earlier document stored, oldest first. Invalid entries are skipped. */
function readStoredPositions(storage: Storage): Array<[string, ScrollPosition]> {
  const positions: Array<[string, ScrollPosition]> = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SESSION_STORAGE_POSITIONS) ?? '[]');
    if (!Array.isArray(parsed)) return positions;
    for (const entry of parsed) {
      if (!Array.isArray(entry)) continue;
      const [key, x, y] = entry as unknown[];
      if (typeof key === 'string' && Number.isFinite(x) && Number.isFinite(y)) {
        positions.push([key, { x: x as number, y: y as number }]);
      }
    }
  } catch {
    // Restricted storage or a corrupted value starts with nothing saved.
  }
  return positions;
}

function findHashElement(doc: Document, hash: string): Element | null {
  if (hash === '' || hash === '#') return null;
  const rawId = hash.startsWith('#') ? hash.slice(1) : hash;
  let decodedId: string;
  try { decodedId = decodeURIComponent(rawId); }
  catch { decodedId = rawId; }
  return (
    doc.getElementById(decodedId) ??
    doc.getElementsByName(decodedId)[0] ?? null
  );
}

export function createScrollCoordinator(
  options: ScrollCoordinatorOptions = {},
): ScrollCoordinator {
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window);
  const doc = options.document ?? win?.document;
  const history = options.history ?? win?.history;
  let storage: Storage | undefined;
  try { storage = win?.sessionStorage; } catch { /* Restricted storage. */ }

  /** Offsets by history key, least recently saved first, at most `MAX_SAVED_POSITIONS`. */
  const memoryPositions = new Map<string, ScrollPosition>();
  /**
   * The offset each page (path and query) had when it was last left, for links back to it.
   * Memory only: a reload or a full-page sign-out starts every page at the top again.
   */
  const pagePositions = new Map<string, ScrollPosition>();
  /** Whether the offsets in session storage have been merged into `memoryPositions`. */
  let storageRead = false;
  /** Whether `memoryPositions` has offsets session storage does not have yet. */
  let unsaved = false;
  let activeKey: string | null = null;
  let activePage: string | null = null;
  /** The page shown when the current navigation began, set by `capture`. */
  let leftPage: string | null = null;
  let previousScrollRestoration: ScrollRestoration | undefined;
  let pendingFrame: number | null = null;
  let connected = false;
  let disposed = false;
  let awaitingRestoration = false;
  let generation = 0;
  const restoreFrames = new Map<number, boolean>();
  let hashObserver: MutationObserver | null = null;
  let disconnectListeners: (() => void) | null = null;

  function cancelRestore(): void {
    generation++;
    awaitingRestoration = false;
    for (const [handle, animationFrame] of restoreFrames) {
      if (animationFrame) win?.cancelAnimationFrame?.(handle);
      else clearTimeout(handle);
    }
    restoreFrames.clear();
    hashObserver?.disconnect();
    hashObserver = null;
  }

  function schedule(fn: () => void, token: number): void {
    if (win === undefined || disposed || token !== generation) return;
    let ran = false;
    let handle = 0;
    const run = () => {
      ran = true;
      restoreFrames.delete(handle);
      if (!disposed && token === generation) fn();
    };
    const animationFrame = typeof win.requestAnimationFrame === 'function';
    handle = animationFrame ? win.requestAnimationFrame(run) : setTimeout(run, 0) as unknown as number;
    // Test adapters may run synchronously; do not retain a completed handle.
    if (!ran) restoreFrames.set(handle, animationFrame);
  }

  function currentPosition(): ScrollPosition {
    if (win === undefined) return { x: 0, y: 0 };
    return {
      x: win.scrollX ?? win.pageXOffset ?? 0,
      y: win.scrollY ?? win.pageYOffset ?? 0,
    };
  }

  /**
   * Merges what an earlier document stored, once. Those offsets are older than any this document
   * saved, so they go first, and this document's win for a key both have.
   */
  function readStorage(): void {
    if (storageRead) return;
    storageRead = true;
    if (storage === undefined) return;
    const stored = readStoredPositions(storage);
    if (stored.length === 0) return;
    const saved = [...memoryPositions];
    memoryPositions.clear();
    for (const [key, position] of stored) memoryPositions.set(key, position);
    // Deleting first moves this document's keys after the stored ones.
    for (const [key] of saved) memoryPositions.delete(key);
    for (const [key, position] of saved) memoryPositions.set(key, position);
    while (memoryPositions.size > MAX_SAVED_POSITIONS) {
      memoryPositions.delete(memoryPositions.keys().next().value!);
    }
  }

  /**
   * Stores every saved offset, so a reload, or a return to this document from another, can
   * restore any entry of it. It runs when the page is hidden, which comes before either.
   */
  function writeStorage(): void {
    if (storage === undefined || !unsaved) return;
    readStorage();
    const entries: Array<[string, number, number]> = [];
    for (const [key, position] of memoryPositions) entries.push([key, position.x, position.y]);
    try {
      storage.setItem(SESSION_STORAGE_POSITIONS, JSON.stringify(entries));
      unsaved = false;
    } catch {
      // QuotaExceeded or restricted storage — fail silently.
    }
  }

  function savePosition(key: string, pos: ScrollPosition): void {
    // Saved again, an entry becomes the newest, so the bound drops the one left longest ago.
    memoryPositions.delete(key);
    if (memoryPositions.size >= MAX_SAVED_POSITIONS) {
      memoryPositions.delete(memoryPositions.keys().next().value!);
    }
    memoryPositions.set(key, pos);
    unsaved = true;
  }

  function pageOf(url: URL): string {
    return `${url.pathname}${url.search}`;
  }

  /** Remembers where `page` was left. The newest pages are kept, up to the same bound as entries. */
  function rememberPage(page: string, pos: ScrollPosition): void {
    pagePositions.delete(page);
    if (pagePositions.size >= MAX_SAVED_POSITIONS) {
      const oldest = pagePositions.keys().next().value;
      if (oldest !== undefined) pagePositions.delete(oldest);
    }
    pagePositions.set(page, pos);
  }

  /**
   * Where a link to `page` should land: where the person left it, so a section reached from
   * the navigation opens where they were, as an app's tabs do. A link to the page already
   * shown, or to one not visited yet, goes to the top.
   */
  function linkPosition(page: string, leaving: string | null): ScrollPosition {
    if (page !== leaving) {
      const remembered = pagePositions.get(page);
      if (remembered !== undefined) return remembered;
    }
    return { x: 0, y: 0 };
  }

  function getPosition(key: string): ScrollPosition | undefined {
    const memory = memoryPositions.get(key);
    if (memory !== undefined || storageRead) return memory;
    readStorage();
    return memoryPositions.get(key);
  }

  function onScroll(): void {
    if (awaitingRestoration || disposed) return;
    if (activeKey === null) return;
    if (pendingFrame !== null) return;
    const key = activeKey;
    const token = generation;
    let ran = false;
    const run = () => {
      ran = true;
      pendingFrame = null;
      if (!disposed && key === activeKey && token === generation) {
        savePosition(key, currentPosition());
      }
    };
    const handle = win?.requestAnimationFrame !== undefined
      ? win.requestAnimationFrame(run)
      : setTimeout(run, 0) as unknown as number;
    if (!ran) pendingFrame = handle;
  }

  /** `pagehide` keeps back/forward cache eligibility, unlike `beforeunload`. */
  function onPageHide(): void {
    if (disposed) return;
    if (activeKey !== null && !awaitingRestoration) savePosition(activeKey, currentPosition());
    writeStorage();
  }

  function onVisibilityChange(): void {
    if (doc?.visibilityState === 'hidden') onPageHide();
  }

  /**
   * A wheel that moves the page up or down is the person scrolling, which wins over a pending
   * restore. A mostly sideways one is not: a touchpad swipe back sends those, and some arrive
   * after the entry has changed, when they would cancel the very restore the swipe asked for.
   */
  function onWheel(event: Event): void {
    const wheel = event as WheelEvent;
    if (Math.abs(wheel.deltaX ?? 0) > Math.abs(wheel.deltaY ?? 0)) return;
    cancelRestore();
  }

  function onScrollIntent(event: Event): void {
    const key = (event as KeyboardEvent).key;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)) {
      cancelRestore();
    }
  }

  return {
    capture(key) {
      if (disposed) return;
      const targetKey = key ?? activeKey;
      // Capturing the shown entry means it is being left.
      if (targetKey === activeKey) leftPage = activePage;
      if (awaitingRestoration && targetKey === activeKey) return;
      if (targetKey !== null && targetKey !== undefined) {
        const position = currentPosition();
        savePosition(targetKey, position);
        if (targetKey === activeKey && activePage !== null) rememberPage(activePage, position);
      }
    },

    cancel: cancelRestore,

    restore(url, type, key, ready) {
      if (disposed) return;
      cancelRestore();
      const token = generation;
      activeKey = key ?? null;
      const page = pageOf(url);
      activePage = page;
      // From the last capture, not the last restore: the runtime restores a pushed entry twice,
      // the second time only to give it the key the browser committed.
      const leavingPage = leftPage;
      if (win === undefined) return;
      awaitingRestoration = true;
      const apply = () => {
        if (disposed || token !== generation) return;
        // A saved history offset takes precedence over the entry's hash. A load reads it too:
        // `connect` sets `history.scrollRestoration` to 'manual', which the browser keeps on the
        // entry, so after a reload (or a cross-document return to this entry) the browser
        // leaves the page at the top. The entry keeps its key across the reload, and `pagehide`
        // stored its offset in session storage, so the coordinator restores it instead. A fresh
        // visit is a new entry with no saved offset and keeps the browser's position.
        const saved = (type === 'pop' || type === 'load') && key != null ? getPosition(key) : undefined;
        if (saved !== undefined) {
          schedule(() => {
            awaitingRestoration = false;
            win.scrollTo(saved.x, saved.y);
          }, token);
          return;
        }

        // Hash targets may be created by a later resource commit. Observe DOM
        // readiness instead of assuming they appear within two animation frames.
        if (url.hash !== '' && url.hash !== '#' && doc !== undefined) {
          const tryHash = () => {
            if (disposed || token !== generation) return true;
            const element = findHashElement(doc, url.hash);
            if (element === null) return false;
            hashObserver?.disconnect();
            hashObserver = null;
            awaitingRestoration = false;
            element.scrollIntoView({ block: 'start' });
            return true;
          };
          schedule(() => {
            if (tryHash()) return;
            const Observer = (win as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver;
            if (Observer !== undefined && doc.documentElement != null) {
              hashObserver = new Observer(() => { tryHash(); });
              hashObserver.observe(doc.documentElement, {
                childList: true, subtree: true, attributes: true,
                attributeFilter: ['id', 'name'],
              });
            } else awaitingRestoration = false;
          }, token);
          return;
        }

        // A link opens its page where it was last left, or at the top.
        if (type === 'push') {
          const position = linkPosition(page, leavingPage);
          schedule(() => {
            awaitingRestoration = false;
            win.scrollTo(position.x, position.y);
          }, token);
          return;
        }

        // History traversals without a snapshot fall back to top.
        if (type === 'pop') {
          schedule(() => {
            awaitingRestoration = false;
            win.scrollTo(0, 0);
          }, token);
          return;
        }

        // Load/replace retain current position when no hash target is provided.
        awaitingRestoration = false;
      };
      if (ready === undefined) apply();
      else void Promise.resolve(ready).then(apply, () => {
        if (token === generation) cancelRestore();
      });
    },

    connect() {
      if (disposed) throw new Error('Cannot connect a disposed scroll coordinator');
      if (connected) return () => {};
      connected = true;

      if (history !== undefined && 'scrollRestoration' in history) {
        previousScrollRestoration = history.scrollRestoration;
        try {
          history.scrollRestoration = 'manual';
        } catch {
          // Some custom or mock history objects may reject assignment.
        }
      }

      if (win !== undefined) {
        win.addEventListener('scroll', onScroll, { passive: true });
        win.addEventListener('pagehide', onPageHide);
        // User intent takes precedence over a target appearing much later.
        win.addEventListener('wheel', onWheel, { passive: true });
        win.addEventListener('touchstart', cancelRestore, { passive: true });
        win.addEventListener('keydown', onScrollIntent);
      }
      doc?.addEventListener?.('visibilitychange', onVisibilityChange);

      disconnectListeners = () => {
        if (!connected) return;
        connected = false;
        cancelRestore();

        if (pendingFrame !== null && win !== undefined) {
          if (win.cancelAnimationFrame !== undefined) win.cancelAnimationFrame(pendingFrame);
          else clearTimeout(pendingFrame);
          pendingFrame = null;
        }

        if (
          history !== undefined &&
          previousScrollRestoration !== undefined &&
          'scrollRestoration' in history
        ) {
          try {
            history.scrollRestoration = previousScrollRestoration;
          } catch {
            // Ignore failure on restoration.
          }
        }

        if (win !== undefined) {
          win.removeEventListener('scroll', onScroll);
          win.removeEventListener('pagehide', onPageHide);
          win.removeEventListener('wheel', onWheel);
          win.removeEventListener('touchstart', cancelRestore);
          win.removeEventListener('keydown', onScrollIntent);
        }
        doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
      };
      return disconnectListeners;
    },

    dispose() {
      if (disposed) return;
      // A runtime created after this one in the same document can still restore its entries.
      writeStorage();
      disconnectListeners?.();
      disposed = true;
      cancelRestore();
      memoryPositions.clear();
      pagePositions.clear();
      activeKey = null;
      activePage = null;
      leftPage = null;
      if (pendingFrame !== null && win !== undefined) {
        if (win.cancelAnimationFrame !== undefined) win.cancelAnimationFrame(pendingFrame);
        else clearTimeout(pendingFrame);
        pendingFrame = null;
      }
    },
  };
}
