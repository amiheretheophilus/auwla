import {
  $track,
  type AsyncStatus,
  type RequestError,
  type ResolvedValue,
} from '@memoized-dom/data';

/** Whether the source is waiting for its first value. */
export function pending<T>(source: ResolvedValue<T>): boolean {
  return $track(source).pending;
}

/** Whether the source is reloading while its previous value remains available. */
export function refreshing<T>(source: ResolvedValue<T>): boolean {
  return $track(source).refreshing;
}

/** Whether the source currently owns an open or reconnecting stream. */
export function streaming<T>(source: ResolvedValue<T>): boolean {
  return $track(source).streaming;
}

/** The current request lifecycle state for the source. */
export function status<T>(source: ResolvedValue<T>): AsyncStatus {
  return $track(source).status;
}

/** The current request failure, or `null` when the source has not failed. */
export function error<T>(source: ResolvedValue<T>): RequestError | null {
  return $track(source).error;
}
