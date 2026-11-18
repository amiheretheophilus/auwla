import crossws from 'crossws/adapters/node';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { matchesSocket, socketHost } from './host';
import { MAX_MESSAGE_BYTES } from './room';

interface Application {
  fetch(request: Request, options?: { platform?: unknown }): Promise<Response>;
}

/** The generated listener passes its normal Web Request and the native upgrade socket. */
export function attachNodeSockets<T extends Application>(application: T, endpoints: readonly string[]) {
  const host = socketHost((request, platform) => application.fetch(request, { platform }));
  const adapter = crossws({ hooks: host.hooks, serverOptions: { maxPayload: MAX_MESSAGE_BYTES } });
  const paths = new Set(endpoints);

  async function handleUpgrade(request: Request, incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!matchesSocket(request, paths)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }

    host.platform(request, { incoming, socket });
    await adapter.handleUpgrade(incoming, socket, head, request);
  }

  return Object.assign(application, {
    handleUpgrade,
    closeSockets() {
      host.invalidateUpgrades();
      return adapter.close(1012, 'Server reloaded');
    },
  });
}
