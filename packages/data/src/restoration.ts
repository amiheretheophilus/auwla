/** Optional transfer consumer and hydration handoff on the existing fetch store. */
import {getActiveEnvironment} from '@memoized-dom/runtime';
import {RequestError, type RequestErrorKind} from './errors';
import {fetchTransferContract, fetchTransferIdentity} from './request-transfer';
import type {FetchStore, FetchRestoration} from './resource';
import {fetchStoreForRuntime, fetchRestorationForRuntime, installFetchTransferIdentity, type CoreDataRuntime} from './runtime-core';
import type {DataRuntime, SerializedDataState, SerializedSourceRecord, SerializedSourceSnapshot} from './types';
type FetchEntry = FetchStore['allEntries'] extends Set<infer Entry> ? Entry : never;
const awaitingDelivery = (record: SerializedSourceRecord): boolean =>
  record.snapshot.status !== 'error' && record.snapshot.streamed === true;

/**
 * Apply a restored record to a freshly acquired entry. Success restores as
 * committed (no duplicate request), error restores its local Error branch,
 * pending resumes after the hydration handoff (RFC §16.6.6–16.6.8).
 */
function seedEntryFromRecord(
  entry: FetchEntry,
  record: SerializedSourceRecord,
): Promise<unknown> | undefined {
  const { snapshot } = record;
  if (snapshot.status === 'success') {
    let data=snapshot.data;
    if(fetchTransferContract(entry.descriptor.schema)==='mmd-fetch/v1:page:1') {
      const validated=entry.descriptor.schema!['~standard'].validate(data);
      const result=(value:Awaited<typeof validated>)=>{
        if(value.issues)throw new RequestError('Invalid restored server page',{kind:'validation',issues:value.issues});
        return value.value;
      };
      if(validated instanceof Promise)return entry.restoreValidated(validated.then(result),snapshot.revalidate,snapshot.streamed);
      data=result(validated);
    }
    entry.snapshot = {
      data,
      error: null,
      status: 'success',
      pending: false,
      refreshing: snapshot.revalidate,
      ...(snapshot.streamed ? {streaming:true} : {}),
    };
    entry.hasData = true;
    return;
  }
  if (snapshot.status === 'error') {
    entry.snapshot = {
      data: undefined,
      error: new RequestError(snapshot.error.message, {
        kind: snapshot.error.kind as RequestErrorKind,
        status: snapshot.error.status ?? undefined,
        statusText: snapshot.error.statusText ?? undefined,
      }),
      status: 'error',
      pending: false,
      refreshing: false,
    };
    return;
  }
  entry.snapshot = {
    data: undefined,
    error: null,
    status: 'pending',
    pending: true,
    refreshing: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TRANSFER_ERROR_KINDS = new Set<RequestErrorKind>([
  'network',
  'http',
  'decode',
  'validation',
]);

function isSerializedSnapshot(value: unknown): value is SerializedSourceSnapshot {
  if (!isRecord(value)) return false;
  if (value.status === 'pending') return true;
  if (value.status === 'success') {
    return typeof value.revalidate === 'boolean' && Object.hasOwn(value, 'data');
  }
  if (value.status !== 'error' || !isRecord(value.error)) return false;
  return typeof value.error.kind === 'string' &&
    TRANSFER_ERROR_KINDS.has(value.error.kind as RequestErrorKind) &&
    (value.error.status === null || typeof value.error.status === 'number') &&
    (value.error.statusText === null || typeof value.error.statusText === 'string') &&
    typeof value.error.message === 'string';
}

function isSerializedSourceRecord(value: unknown): value is SerializedSourceRecord {
  if (!isRecord(value)) return false;
  return typeof value.sourceId === 'string' &&
    value.sourceId.length > 0 &&
    typeof value.contractId === 'string' &&
    value.contractId.startsWith('mmd-fetch/v1:') &&
    value.requestFingerprint === value.sourceId &&
    isSerializedSnapshot(value.snapshot);
}


class RestoredFetchStore implements FetchRestoration {
  private readonly restoreRecords = new Map<string, SerializedSourceRecord>();
  private readonly streamWaiters = new Map<string, Set<FetchEntry>>();
  private readonly retiredStreams = new Set<string>();
  private hydrationBlocked = false;
  private readonly deferredStarts = new Set<FetchEntry>();

  constructor(private readonly store: FetchStore) {}

  install(state: SerializedDataState): void {
    for (const record of this.records(state)) this.restoreRecords.set(record.sourceId, record);
  }

  private records(state: SerializedDataState): SerializedSourceRecord[] {
    if (!isRecord(state)) {
      throw new TypeError('Serialized data state must be an object');
    }
    const version: unknown = state.formatVersion;
    if (version !== 1) {
      throw new TypeError(
        `Unsupported serialized data state format: ${String(version)}`,
      );
    }
    const sources: unknown = state.sources;
    if (!Array.isArray(sources)) {
      throw new TypeError('Serialized data state sources must be an array');
    }
    return sources.filter(isSerializedSourceRecord);
  }

  deliverStreamedState(state: SerializedDataState): void {
    for (const record of this.records(state)) {
      if (record.snapshot.status === 'pending' || this.retiredStreams.has(record.sourceId)) continue;
      const waiters = this.streamWaiters.get(record.sourceId);
      if (waiters === undefined) {
        this.restoreRecords.set(record.sourceId, record);
        continue;
      }
      for (const entry of [...waiters]) {
        if (!this.store.allEntries.has(entry) || record.contractId !== fetchTransferContract(entry.descriptor.schema)) continue;
        waiters.delete(entry);
        const restoring=seedEntryFromRecord(entry, record);
        const awaiting = awaitingDelivery(record);
        if (awaiting) waiters.add(entry);
        entry.emit();
        if(restoring){
          void restoring.then(()=>{
            if(!awaiting&&this.store.allEntries.has(entry)&&(record.snapshot.status==='success'&&(record.snapshot.revalidate||entry.descriptor.stream==='live'))){
              if(this.hydrationBlocked){entry.deferStart();this.deferredStarts.add(entry);}
              else entry.start(true).catch(()=>{});
            }
          },()=>{});
          continue;
        }
        if (!awaiting && this.store.allEntries.has(entry) && record.snapshot.status === 'success' &&
          (record.snapshot.revalidate || entry.descriptor.stream === 'live')) {
          if (this.hydrationBlocked) {
            entry.deferStart();
            this.deferredStarts.add(entry);
          } else entry.start(true).catch(() => {});
        }
      }
      if (waiters.size === 0) {
        this.streamWaiters.delete(record.sourceId);
        this.restoreRecords.delete(record.sourceId);
        this.retiredStreams.add(record.sourceId);
      }
    }
  }

  endStream(): void {
    const waiting = [...this.streamWaiters.values()].flatMap(entries => [...entries]);
    for (const entry of waiting) {
      this.release(entry);
      if (!this.store.allEntries.has(entry) || entry.request !== null) continue;
      if (this.hydrationBlocked) {
        entry.deferStart();
        this.deferredStarts.add(entry);
      } else entry.start(true).catch(() => {});
    }
    for (const [identity, record] of this.restoreRecords) {
      if (record.snapshot.status === 'pending' && record.snapshot.streamed) {
        this.restoreRecords.set(identity, {...record, snapshot: {status: 'pending'}});
      } else if (record.snapshot.status === 'success' && record.snapshot.streamed) {
        this.restoreRecords.set(identity, {...record, snapshot: {...record.snapshot, streamed: false, revalidate: true}});
      }
    }
  }

  private takeRestoreRecord(
    identity: string | null,
    contractId: string,
  ): SerializedSourceRecord | undefined {
    if (identity === null) return undefined;
    const record = this.restoreRecords.get(identity);
    if (record === undefined || record.contractId !== contractId) return undefined;
    if (!awaitingDelivery(record)) this.restoreRecords.delete(identity);
    return record;
  }

  start(entry: FetchEntry, force: boolean): void {
    const descriptor = entry.descriptor;
    const restored = this.takeRestoreRecord(
      descriptor.transferIdentity,
      fetchTransferContract(descriptor.schema),
    );
    const awaitingStream = restored !== undefined && awaitingDelivery(restored);
    if (restored !== undefined) {
      const restoring=seedEntryFromRecord(entry, restored);
      if (awaitingStream) {
        let waiters = this.streamWaiters.get(restored.sourceId);
        if (waiters === undefined) this.streamWaiters.set(restored.sourceId, waiters = new Set());
        waiters.add(entry);
      }
      entry.emit();
      if(restoring){
        void restoring.then(()=>{
          if(!this.store.allEntries.has(entry))return;
          if(force||!awaitingStream&&restored.snapshot.status==='success'&&(restored.snapshot.revalidate||descriptor.stream==='live')){
            if(this.hydrationBlocked){entry.deferStart();this.deferredStarts.add(entry);}
            else entry.start(true).catch(()=>{});
          }
        },()=>{});
        return;
      }
    }
    // Ordinary seeded entries resume only through an explicit refresh — a restored
    // success must not re-issue its request (RFC §16.6.6) and a restored
    // error retries only through its restored source handle (§16.6.8).
    // Shell pending entries fetch after adoption. Streamed entries wait for
    // delivery or the end of parsing; explicit refresh takes ownership. Live
    // queries open their ongoing subscription after the snapshot is adopted.
    const shouldStart =
      force ||
      (restored === undefined &&
        (entry.snapshot.status === 'idle' ||
          entry.snapshot.status === 'error')) ||
      (restored !== undefined &&
        ((restored.snapshot.status === 'pending' && !awaitingStream) ||
          (restored.snapshot.status === 'success' && restored.snapshot.revalidate)));
    const reconnectLive = !awaitingStream && restored?.snapshot.status === 'success' && descriptor.stream === 'live';
    if (getActiveEnvironment().mode === 'hydrate') {
      this.hydrationBlocked = true;
      if (shouldStart || reconnectLive) {
        entry.deferStart();
        this.deferredStarts.add(entry);
      }
    } else if (shouldStart || reconnectLive) {
      // Incomplete page handoffs must resume even though a partial payload
      // exists. Keep the ordinary source restoration/revalidation policy.
      entry.start(force || reconnectLive || descriptor.stream === 'page').catch(() => {});
    }
  }

  resumeHydration(): void {
    if (!this.hydrationBlocked) return;
    this.hydrationBlocked = false;
    for (const entry of [...this.deferredStarts]) {
      this.deferredStarts.delete(entry);
      if (entry.request === null) entry.start(true).catch(() => {});
    }
  }

  cancelHydration(): void {
    this.hydrationBlocked = false;
    for (const entry of [...this.deferredStarts]) {
      entry.cancelDeferredStart();
    }
  }

  release(entry: FetchEntry): void {
    this.deferredStarts.delete(entry);
    for (const [identity, waiters] of this.streamWaiters) {
      if (waiters.delete(entry) && waiters.size === 0) {
        this.streamWaiters.delete(identity);
        this.restoreRecords.delete(identity);
        this.retiredStreams.add(identity);
      }
    }
  }
  clear(): void {
    this.restoreRecords.clear();
    this.streamWaiters.clear();
    this.retiredStreams.clear();
    this.deferredStarts.clear();
    this.hydrationBlocked = false;
  }
}

/** Public or SSR delivery enables transfer on the same runtime/cache boundary. */
export function enableDataRestoration<T extends CoreDataRuntime>(runtime: T): T & Pick<DataRuntime, 'restoreState'> {
  if ('restoreState' in runtime) return runtime as T & Pick<DataRuntime, 'restoreState'>;
  installFetchTransferIdentity(runtime, fetchTransferIdentity);
  const store = fetchStoreForRuntime(runtime);
  const restoration = new RestoredFetchStore(store);
  store.restoration = restoration;
  return Object.assign(runtime, {restoreState(state: SerializedDataState) { restoration.install(state); }});
}
export function resumeDataHydration(runtime: CoreDataRuntime): void {
  fetchRestorationForRuntime(runtime)?.resumeHydration();
}
export function cancelDataHydration(runtime: CoreDataRuntime): void {
  fetchRestorationForRuntime(runtime)?.cancelHydration();
}

export function deliverStreamedDataState(runtime: CoreDataRuntime, state: SerializedDataState): void {
  fetchRestorationForRuntime(runtime)?.deliverStreamedState(state);
}

export function endDataStream(runtime: CoreDataRuntime): void {
  fetchRestorationForRuntime(runtime)?.endStream();
}
