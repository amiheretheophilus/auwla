import type { ServerSocketSession } from './definition';

// Native listeners and generated routes can be in different bundles. The
// capability is on the in-memory request and cannot be set by an HTTP client.
const UPGRADE = Symbol.for('memo-dom:socket-upgrade');

export interface PreparedSocket {
  readonly room: string;
  readonly session: ServerSocketSession<unknown>;
}

interface UpgradeCapture {
  prepared?: PreparedSocket;
}

export function socketUpgrade(request: Request): UpgradeCapture | undefined {
  return Reflect.get(request, UPGRADE) as UpgradeCapture | undefined;
}

/** Release a session when middleware or the native listener rejects its upgrade. */
export async function discardPreparedSocket(prepared: PreparedSocket | undefined): Promise<void> {
  try {
    await prepared?.session.close?.();
  } catch (error) {
    console.error('[memo-dom] Rejected WebSocket cleanup failed', error);
  }
}

export async function prepareSocket(
  request: Request,
  dispatch: (request: Request) => Promise<Response>,
): Promise<{ prepared: PreparedSocket; headers: Headers }> {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site'
    || (origin !== null && origin !== new URL(request.url).origin)) {
    throw new Response('WebSocket origin is forbidden', { status: 403 });
  }

  const capture: UpgradeCapture = {};
  Object.defineProperty(request, UPGRADE, { value: capture, configurable: true });
  const response = await Promise.resolve().then(() => dispatch(request)).finally(() => {
    Reflect.deleteProperty(request, UPGRADE);
  });

  if (!response.ok || capture.prepared === undefined) {
    await discardPreparedSocket(capture.prepared);
    throw response;
  }

  await response.body?.cancel();
  return { prepared: capture.prepared, headers: response.headers };
}
