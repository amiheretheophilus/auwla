// Native hosts and generated routes may load separate server module instances.
// Carry the policy on the server-created context, never in an HTTP header.
export const LIVE_HEARTBEAT_INTERVAL = Symbol.for('memoized-dom:live-heartbeat-interval');

/** One idle keep-alive policy shared by direct and multiplexed live SSE. */
export function resolveLiveHeartbeatInterval(value: number = 15_000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new RangeError('liveHeartbeatInterval must be an integer from 1 to 2147483647 milliseconds');
  }
  return value;
}
