import { fileURLToPath } from 'node:url';
import { readDiagnostic, type DiagnosticEvent } from '@memoized-dom/devtools';
import type { ViteDevServer, WebSocketClient } from 'vite';
import type { FullstackPluginApi } from './fullstack';

export const inspectorId = 'virtual:memoized-dom/inspector';
export const resolvedInspectorId = '\0' + inspectorId;
const openEvent = 'memoized-dom:inspector:open', closeEvent = 'memoized-dom:inspector:close', outputEvent = 'memoized-dom:inspector:event';

/** This instance belongs to exactly one Vite server, not a process-global event bus. */
export function configureInspector(server: ViteDevServer, api: FullstackPluginApi): void {
  const clients = new Map<WebSocketClient, () => void>();
  let started = 0, count = 0;
  const relay = (data: DiagnosticEvent) => {
    for (const [client, release] of clients) {
      // Detach only this observer, never the application's HMR connection.
      if (client.socket.bufferedAmount > 512 * 1024) { release(); continue; }
      try { client.send({ type: 'custom', event: outputEvent, data }); } catch { release(); }
    }
  };
  const sink = (input: DiagnosticEvent) => {
    if (!clients.size) return;
    const now = Date.now(); if (now < started || now - started >= 1000) { started = now; count = 0; }
    if (++count > 500) {
      if (count === 501) relay({ version: 1, domain: 'trace', event: 'trace-throttled', origin: 'server', timestamp: now, data: { scope: 'server-relay', limit: 500, windowMs: 1000 } });
      return; // Diagnostic relay never creates an unbounded HMR queue.
    }
    const event = readDiagnostic(input); if (!event || event.origin !== 'server') return;
    relay(event);
  };
  api.diagnosticSink = sink;
  const close = (_data: unknown, client: WebSocketClient) => { clients.get(client)?.(); };
  const open = (_data: unknown, client: WebSocketClient) => {
    if (clients.has(client) || clients.size >= 16) return;
    const release = () => { clients.delete(client); client.socket.off('close', release); };
    clients.set(client, release); client.socket.once('close', release);
    try { client.send({ type: 'custom', event: 'memoized-dom:inspector:ready', data: { version: 1, server: api.nativeDevelopment && api.runtime !== 'cloudflare' } }); }
    catch { release(); }
  };
  server.ws.on(openEvent, open); server.ws.on(closeEvent, close);
  const originalClose = server.close.bind(server);
  server.close = async () => {
    server.ws.off(openEvent, open); server.ws.off(closeEvent, close);
    for (const release of clients.values()) release();
    if (api.diagnosticSink === sink) delete api.diagnosticSink;
    return originalClose();
  };
}

export function inspectorSource(api: FullstackPluginApi): string {
  const bootstrap = fileURLToPath(import.meta.resolve('@memoized-dom/devtools/bootstrap')).replaceAll('\\', '/');
  const client = fileURLToPath(import.meta.resolve('@memoized-dom/devtools/client')).replaceAll('\\', '/');
  return `import {setupInspector} from ${JSON.stringify(bootstrap)};
setupInspector(()=>import(${JSON.stringify(client)}),import.meta.hot,${api.nativeDevelopment && api.runtime !== 'cloudflare'});`;
}
