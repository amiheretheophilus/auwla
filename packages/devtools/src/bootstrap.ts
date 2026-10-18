interface Panel { dispose(): void }
export interface InspectorHot {
  on(event: string, listener: (data: unknown) => void): void;
  off(event: string, listener: (data: unknown) => void): void;
  send(event: string, data?: unknown): void;
  dispose(callback: () => void): void;
}
export interface InspectorModule { mountInspector(options: { hot?: InspectorHot; server: boolean; close(): void }): Panel }
/** Tiny entry. The renderer, styles and fonts are loaded only when explicitly opened. */
export function setupInspector(load: () => Promise<InspectorModule>, hot?: InspectorHot, server = false): () => void {
  let panel: Panel | undefined, opening = false, disposed = false, generation = 0;
  const close = () => { generation++; opening = false; const previous = panel; panel = undefined; previous?.dispose(); };
  const open = async () => {
    if (panel || opening || disposed) return;
    opening = true; const current = ++generation;
    try {
      const module = await load();
      if (disposed || current !== generation) return;
      panel = module.mountInspector({ hot, server, close });
    } catch { console.warn('[memoized-dom] Could not load the development inspector. Application execution is unchanged.'); }
    finally { if (current === generation) opening = false; }
  };
  const key = (event: KeyboardEvent) => {
    if (!event.repeat && event.altKey && event.shiftKey && event.code === 'KeyM' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); if (panel || opening) close(); else void open();
    }
  };
  window.addEventListener('keydown', key);
  const dispose = () => { disposed = true; close(); window.removeEventListener('keydown', key); };
  hot?.dispose(dispose);
  if (new URL(location.href).searchParams.has('mmd-inspect')) void open();
  return dispose;
}
