import { sameValue, type PresenceInput } from './protocol';

const POINTER_INTERVAL = 150;
const DRAG_INTERVAL = 55;

/** Coalesce intermediate pointer positions while the last update is in flight. */
export function createPresenceSender(current: () => PresenceInput, publish: (entry: PresenceInput) => Promise<boolean>) {
  let sent: PresenceInput | undefined;
  let last = 0;
  let running = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function send(force = false): void {
    clearTimeout(timer);
    timer = undefined;
    if (closed || running || document.hidden) return;

    const latest = current();
    if (!force && sameValue(sent, latest)) return;

    running = true;
    last = Date.now();
    void publish(latest).then(accepted => {
      if (accepted) sent = latest;
    }, () => undefined).then(() => {
      running = false;
      if (sent === latest) update();
    });
  }

  function update(): void {
    if (closed || running || timer !== undefined || document.hidden) return;

    const latest = current();
    if (sameValue(sent, latest)) return;

    const dragging = latest.drag !== undefined && latest.drag.committedRevision === undefined;
    const interval = dragging ? DRAG_INTERVAL : POINTER_INTERVAL;
    const elapsed = Date.now() - last;
    timer = setTimeout(send, Math.max(0, interval - elapsed));
  }

  function visibilityChanged(): void {
    if (!document.hidden) send(true);
  }

  document.addEventListener('visibilitychange', visibilityChanged);
  send();

  return {
    update,
    reconnect() {
      sent = undefined;
      send(true);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
