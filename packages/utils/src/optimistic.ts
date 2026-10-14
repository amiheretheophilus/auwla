import { $read } from '@memoized-dom/data';
import type { FetchResource, RequestError, ResolvedValue } from '@memoized-dom/data';
import { disposeFetchResource, isFetchResource, subscribeFetchResource, trackResolvedValue, protectLiveSources } from '@memoized-dom/data/internal';

type OperationResult =
  | PromiseLike<unknown>
  | FetchResource<unknown>
  | ResolvedValue<unknown>;

type SettledResult<T> =
  T extends PromiseLike<infer U> ? Awaited<U> :
  T extends FetchResource<infer U> ? U :
  T extends ResolvedValue<infer U> ? U :
  never;

export interface OptimisticOptions<TPayload, TResult extends OperationResult> {
  /** Live query source(s) protected from snapshots while associated operations settle. */
  readonly source?: ResolvedValue<unknown> | FetchResource<unknown> | readonly (ResolvedValue<unknown> | FetchResource<unknown>)[];
  /** Start one new request for each call. Its result is returned unchanged. */
  readonly action: (payload: TPayload) => TResult;
  /** Make the immediate change and return its operation-specific rollback. */
  readonly apply: (
    payload: TPayload,
    operationId: string,
  ) => (error: RequestError) => void;
  /** Replace the temporary change with this operation's server result. */
  readonly reconcile?: (
    saved: SettledResult<TResult>,
    payload: TPayload,
    operationId: string,
  ) => void;
}

export interface OptimisticCallOptions {
  /** Group overlapping calls that update the same resource or value. */
  readonly id?: string | number;
}

const seenOperations = new WeakMap<object, string>();
const seenPromises = new WeakSet<object>();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Apply an immediate change and undo only that call if its request fails. */
export function optimistic<TPayload, TResult extends OperationResult>(
  options: OptimisticOptions<TPayload, TResult>,
): (payload: TPayload, callOptions?: OptimisticCallOptions) => TResult {
  type Group = {
    pending: number;
    nextOrder: number;
    latestSuccess?: {
      order: number;
      saved: SettledResult<TResult>;
      payload: TPayload;
      operationId: string;
    };
  };
  const groups = new Map<string | number, Group>();

  return (payload, callOptions) => {
    const releaseSource = protectLiveSources(options.source);
    const id = callOptions?.id;
    let group = id === undefined ? undefined : groups.get(id);
    if (id !== undefined && group === undefined) {
      group = { pending: 0, nextOrder: 0 };
      groups.set(id, group);
    }
    const order = group === undefined ? 0 : group.nextOrder++;
    if (group !== undefined) group.pending++;
    let released = false;
    const releaseGroup = (): void => {
      if (id === undefined || group === undefined || released) return;
      released = true;
      if (--group.pending !== 0) return;
      groups.delete(id);
      const latest = group.latestSuccess;
      if (latest !== undefined) {
        options.reconcile?.(latest.saved, latest.payload, latest.operationId);
      }
    };

    try {
      const result = options.action(payload);
      const existingSource = isFetchResource(result);
      if (!existingSource && !isPromiseLike(result)) {
        throw new TypeError('optimistic action must return a trackable source or promise');
      }
      if (!existingSource) {
        if (seenPromises.has(result)) {
          throw new TypeError('optimistic action must start a new operation for each call');
        }
        seenPromises.add(result);
      }

      // Transparent values are FetchResource holders at runtime; their authored
      // ResolvedValue type intentionally hides those methods from application code.
      const source: FetchResource<unknown> = existingSource
        ? result
        : $read(result) as unknown as FetchResource<unknown>;
      const tracker = trackResolvedValue(source as unknown as ResolvedValue<unknown>);
      const operationId = tracker.id;
      const previousId = seenOperations.get(source);
      if (previousId === operationId) {
        if (!existingSource) disposeFetchResource(source);
        throw new TypeError('optimistic action must start a new operation for each call');
      }
      seenOperations.set(source, operationId);

      let rollback: (error: RequestError) => void;
      try {
        rollback = options.apply(payload, operationId);
        if (typeof rollback !== 'function') {
          throw new TypeError('optimistic apply must return a rollback function');
        }
      } catch (error) {
        if (!existingSource) disposeFetchResource(source);
        throw error;
      }

      let finished = false;
      let stopSuccess = () => {};
      let stopError = () => {};
      let stopAbort = () => {};
      const finish = (): void => {
        if (finished) return;
        finished = true;
        stopSuccess();
        stopError();
        stopAbort();
        if (!existingSource) disposeFetchResource(source);
      };

      stopSuccess = tracker.onSuccess(saved => {
        if (finished) return;
        finish();
        try {
          if (group === undefined) {
            options.reconcile?.(saved as SettledResult<TResult>, payload, operationId);
          } else {
            if (group.latestSuccess === undefined || order > group.latestSuccess.order) {
              group.latestSuccess = {
                order,
                saved: saved as SettledResult<TResult>,
                payload,
                operationId,
              };
            }
            releaseGroup();
          }
        } finally { releaseSource(source); }
      });
      if (!finished) stopError = tracker.onError(error => {
        if (finished) return;
        finish();
        try {
          rollback(error);
        } finally {
          try { releaseGroup(); } finally { releaseSource(); }
        }
      });
      if (!finished && (group !== undefined || options.source !== undefined)) {
        stopAbort = subscribeFetchResource(source, snapshot => {
          if (finished || tracker.id === operationId &&
            (snapshot.pending || snapshot.refreshing || snapshot.status !== 'idle')) return;
          finish();
          try { releaseGroup(); } finally { releaseSource(); }
        });
      }
      return result;
    } catch (error) {
      try {
        releaseGroup();
      } finally {
        releaseSource();
      }
      throw error;
    }
  };
}
