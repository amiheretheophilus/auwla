import { getGlobalControllers } from './global-controllers';
import { isEffectInvocation } from '@memoized-dom/runtime';
import { isSourceComputation } from './source-scope';
import {
  isAbortError,
  toRequestError,
} from './errors';
import { SnapshotNotifier } from './notifications';
import { dispatchResourceWrite } from './resource-write-capability';
import { LiveProtection, updateStamps, type LiveStamp } from './live-protocol';
import { liveDiagnosticName, liveDiagnosticId } from './live-diagnostics';
import {
  disposeFormSource,
  formSourceOperationId,
  formSourceSnapshot,
  isFormSource,
  subscribeFormSource,
  type FormSource,
} from './forms';
import {
  adoptReadResource,
  disposeReadResource,
  isReadResource,
  readResourceIsLive,
  readResourceOperationId,
  readResourceSnapshot,
  subscribeReadResource,
} from './read-resource';
import {
  abortable,
  abortReason,
  decodeResponse,
  fetchIdentity,
  normalizeFetchMethod,
  normalizedHeaders,
  type PreparedRequestBody,
  resolveRequestURL,
} from './request';
import type { fetchTransferIdentity } from './request-transfer';
import type {
  FetchCache,
  FetchMethod,
  FetchOptions,
  FetchResource,
  ResourceListener,
  ResourceSnapshot,
  StandardSchemaV1,
} from './types';

interface FetchDescriptor {
  readonly stream?: 'live' | 'generator' | 'page';
  readonly url: string;
  readonly method: FetchMethod;
  readonly headers: HeadersInit | undefined;
  readonly body: BodyInit | undefined;
  readonly bodyIdentity: string;
  readonly identity: string;
  readonly transferIdentity: string | null;
  readonly cache: FetchCache;
  readonly schema: StandardSchemaV1 | undefined;
  readonly signal: AbortSignal | undefined;
}

let nextRequestId = 1;

function createRequestId(): string {
  return `request-${nextRequestId++}`;
}

export interface FetchEnvironment {
  stream?: (descriptor: FetchDescriptor, signal: AbortSignal, delivery: StreamDelivery) => Promise<unknown>;
  readonly fetch: () => NonNullable<import('./types').DataRuntimeOptions['fetch']>;
  readonly baseURL: string | URL | undefined;
  prepareBody?: (input: unknown, headers: Headers) => PreparedRequestBody;
  transferIdentity?: typeof fetchTransferIdentity;
}

export interface StreamDelivery {
  /** @internal Development metadata only; never serialized onto the application wire. */
  readonly diagnosticSourceId?: string;
  value(data: unknown, stamp?: LiveStamp): void;
  state(streaming: boolean, error?: unknown): void;
  updates(stamps: LiveStamp[]): void;
}

interface MutableSnapshot<T> {
  streaming?: boolean;
  data: T | undefined;
  error: import('./errors').RequestError | null;
  status: ResourceSnapshot<T>['status'];
  pending: boolean;
  refreshing: boolean;
}

/** A null target has already resolved to null; it is not an unfinished request. */
function initialSnapshot<T>(paused = false): MutableSnapshot<T> {
  return {
    data: paused ? (null as T) : undefined,
    error: null,
    status: paused ? 'success' : 'idle',
    pending: false,
    refreshing: false,
  };
}

function publicSnapshot<T>(snapshot: MutableSnapshot<T>): ResourceSnapshot<T> {
  return Object.freeze({ ...snapshot });
}

function normalizedCache(
  cache: FetchCache | undefined,
  method: FetchMethod,
): FetchCache {
  if (cache !== undefined) return cache;
  return method === 'GET' ? 'active' : false;
}

function equalCache(left: FetchCache, right: FetchCache): boolean {
  if (left === right) return true;
  return typeof left === 'object' && typeof right === 'object' &&
    left.scope === right.scope;
}

function equalDescriptor(
  left: FetchDescriptor,
  right: FetchDescriptor,
): boolean {
  return left.identity === right.identity &&
    left.url === right.url &&
    left.method === right.method &&
    normalizedHeaders(left.headers) === normalizedHeaders(right.headers) &&
    left.bodyIdentity === right.bodyIdentity &&
    left.transferIdentity === right.transferIdentity &&
    equalCache(left.cache, right.cache) &&
    left.schema === right.schema &&
    left.signal === right.signal && left.stream === right.stream;
}

class FetchEntry {
  private readonly diagnosticId = liveDiagnosticId('source');
  updates: LiveStamp[] = [];
  private liveProtection: LiveProtection | undefined;
  get protection(): LiveProtection {
    return this.liveProtection ??= new LiveProtection(value => {
      this.snapshot.data = value;
      this.snapshot.pending = false;
      this.snapshot.refreshing = false;
      this.snapshot.status = 'success';
      this.snapshot.error = null;
      this.hasData = true;
      this.emit();
    }, {
      source: liveDiagnosticName(this.descriptor.url),
      method: this.descriptor.method, sourceId: this.diagnosticId ?? this.operationId,
    });
  }
  readonly consumers = new Set<ResourceController<unknown>>();
  snapshot: MutableSnapshot<unknown> = initialSnapshot();
  hasData = false;
  cache: Exclude<FetchCache, false>;
  request: Promise<unknown> | null = null;
  controller: AbortController | null = null;
  operationId = createRequestId();
  private pendingOperationId: string | null = null;
  private generation = 0;

  constructor(
    readonly store: FetchStore,
    readonly descriptor: FetchDescriptor,
  ) {
    this.cache = descriptor.cache === false ? 'active' : descriptor.cache;
  }

  add(controller: ResourceController<unknown>): void {
    this.consumers.add(controller);
    controller.receive(this, this.snapshot);
  }

  remove(controller: ResourceController<unknown>, reason?: unknown): void {
    this.consumers.delete(controller);
    if (this.consumers.size !== 0) return;

    if (this.cache === 'active') {
      this.store.delete(this, reason);
    } else {
      this.cancelRequest(reason);
    }
  }

  cancelRequest(reason?: unknown): void {
    this.cancelDeferredStart();
    if (this.descriptor.stream !== undefined) {
      // A finite stream that already delivered its result is only closing;
      // aborting it would report a cancelled request for a completed one.
      const finished = this.descriptor.stream !== 'live' && this.hasData &&
        !this.snapshot.pending && !this.snapshot.refreshing;
      if (finished) this.generation++;
      else this.controller?.abort(reason);
      this.snapshot.streaming = false;
      this.liveProtection?.clear();
    }
    if (this.controller === null && this.request === null && !this.snapshot.pending && !this.snapshot.refreshing) return;
    // A response may notify consumers from its terminal `then` immediately
    // before the promise finalizer clears these handles. Releasing the final
    // consumer in that window must not turn a completed request into an
    // apparent browser-side cancellation.
    if (!this.snapshot.pending && !this.snapshot.refreshing) {
      this.controller = null;
      this.request = null;
      return;
    }
    this.generation++;
    this.controller?.abort(reason);
    this.controller = null;
    this.request = null;
    this.snapshot.error = null;
    this.snapshot.pending = false;
    this.snapshot.refreshing = false;
    this.snapshot.status = this.hasData ? 'success' : 'idle';
  }

  upgradeCache(cache: FetchCache): void {
    if (typeof cache === 'object') this.cache = cache;
  }

  emit(): void {
    for (const consumer of this.consumers) {
      consumer.receive(this, this.snapshot);
    }
  }

  deferStart(): void {
    if (this.pendingOperationId === null) {
      this.pendingOperationId = createRequestId();
      this.operationId = this.pendingOperationId;
      this.emit();
    }
  }

  /** Compiler protocol restoration may wait for its browser binding artifact. */
  restoreValidated(data:PromiseLike<unknown>,revalidate:boolean,streaming?:boolean):Promise<unknown> {
    this.cancelRequest();
    const generation=++this.generation;
    // `pending` means no data yet; with data on screen a request is a refresh.
    this.snapshot.pending=!this.hasData;this.snapshot.refreshing=this.hasData;
    this.snapshot.status=this.hasData?'success':'pending';
    const request=Promise.resolve(data).then(value=>{
      if(generation !== this.generation)return;
      this.snapshot={data:value,error:null,status:'success',pending:false,refreshing:revalidate,...(streaming?{streaming:true}:{})};
      this.hasData=true;this.emit();return value;
    },error=>{
      if(generation !== this.generation)return;
      this.snapshot.error=toRequestError(error);this.snapshot.status=this.hasData?'success':'error';
      this.snapshot.pending=false;this.snapshot.refreshing=false;this.emit();throw this.snapshot.error;
    }).finally(()=>{if(generation===this.generation)this.request=null;});
    this.request=request;request.catch(()=>{});return request;
  }

  cancelDeferredStart(): void {
    this.store.restoration?.release(this);
    this.pendingOperationId = null;
  }

  start(force = false): Promise<unknown> {
    if (this.request !== null) return this.request;
    if (!force && this.hasData) {
      return Promise.resolve(this.snapshot.data);
    }
    if (this.descriptor.stream !== undefined) this.controller?.abort();

    const generation = ++this.generation;
    this.store.restoration?.release(this);
    this.operationId = this.pendingOperationId ?? createRequestId();
    this.pendingOperationId = null;
    const controller = new AbortController();
    this.controller = controller;
    this.snapshot.error = null;
    // `pending` means no data yet; with data on screen a request is a refresh.
    this.snapshot.pending = !this.hasData;
    this.snapshot.refreshing = this.hasData;
    this.snapshot.status = this.hasData ? 'success' : 'pending';
    this.emit();

    const streaming = this.descriptor.stream !== undefined;
    const streamRequest = streaming ? this.store.environment.stream?.(this.descriptor, controller.signal, {
      ...(this.diagnosticId ? { diagnosticSourceId: this.diagnosticId } : {}),
      value: (data, stamp) => {
        if (generation !== this.generation || controller.signal.aborted) return;
        if (stamp !== undefined) this.protection.receive(data, stamp);
        else {
          this.snapshot.data = data;
          this.snapshot.status = 'success';
          this.snapshot.pending = false;
          this.snapshot.refreshing = false;
          this.hasData = true;
          this.emit();
        }
      },
      state: (open, error) => {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.snapshot.streaming = open;
        if (error !== undefined) {
          this.snapshot.error = toRequestError(error);
          this.snapshot.status = this.hasData ? 'success' : 'error';
          this.snapshot.pending = false;
          this.snapshot.refreshing = false;
        }
        this.emit();
      },
      updates: stamps => { if (generation === this.generation) this.updates = stamps; },
    }) : undefined;
    const request = (streaming ? streamRequest ?? Promise.reject(new Error('Streaming transport is not installed')) : abortable(
      () => this.store.environment.fetch()(this.descriptor.url, {
          method: this.descriptor.method,
          headers: this.descriptor.headers,
          body: this.descriptor.body,
          signal: controller.signal,
        }),
      controller.signal,
    )
      .then(response => {
        this.updates = updateStamps(response.headers.get('x-mmd-updates'));
        return abortable(
        () => decodeResponse(response, this.descriptor.schema),
        controller.signal,
      ); }))
      .then(
        data => {
          if (generation !== this.generation) return data;
          if (streaming) return data;
          this.snapshot = {
            data,
            error: null,
            status: 'success',
            pending: false,
            refreshing: false,
          };
          this.hasData = true;
          this.emit();
          return data;
        },
        error => {
          if (generation !== this.generation) throw error;
          if (controller.signal.aborted || isAbortError(error)) {
            this.snapshot.pending = false;
            this.snapshot.refreshing = false;
            this.snapshot.status = this.hasData ? 'success' : 'idle';
            this.emit();
            throw error;
          }
          this.snapshot.error = toRequestError(error);
          this.snapshot.pending = false;
          this.snapshot.refreshing = false;
          this.snapshot.status = this.hasData ? 'success' : 'error';
          this.emit();
          throw this.snapshot.error;
        },
      )
      .finally(() => {
        if (generation === this.generation) {
          this.request = null;
          if (!streaming) this.controller = null;
        }
      });

    this.request = request;
    request.catch(() => {});
    return request;
  }

  dispose(resetConsumers = false, reason?: unknown): void {
    this.cancelRequest(reason);
    for (const consumer of [...this.consumers]) {
      consumer.detachFrom(this, resetConsumers);
    }
    this.consumers.clear();
  }
}

/** Optional ownership hook; request execution and caches stay in FetchStore. */
export interface FetchRestoration {
  deliverStreamedState(state: import('./types').SerializedDataState): void;
  endStream(): void;
  start(entry: FetchEntry, force: boolean): void;
  release(entry: FetchEntry): void;
  resumeHydration(): void;
  cancelHydration(): void;
  clear(): void;
}

export class FetchStore {
  readonly entries = new Map<string, FetchEntry>();
  readonly allEntries = new Set<FetchEntry>();
  restoration?: FetchRestoration;

  constructor(readonly environment: FetchEnvironment) {}

  delete(entry: FetchEntry, reason?: unknown): void {
    if (this.entries.get(entry.descriptor.identity) === entry) {
      this.entries.delete(entry.descriptor.identity);
    }
    this.allEntries.delete(entry);
    entry.dispose(false, reason);
  }

  acquire(
    descriptor: FetchDescriptor,
    consumer: ResourceController<unknown>,
    force = false,
    replace = false,
  ): FetchEntry {
    let entry: FetchEntry;
    if (descriptor.cache === false) {
      entry = new FetchEntry(this, descriptor);
      this.allEntries.add(entry);
    } else {
      const existing = replace
        ? undefined
        : this.entries.get(descriptor.identity);
      if (existing === undefined) {
        entry = new FetchEntry(this, descriptor);
        this.allEntries.add(entry);
      } else {
        entry = existing;
      }
      this.entries.set(descriptor.identity, entry);
      entry.upgradeCache(descriptor.cache);
    }

    entry.add(consumer);
    if (this.restoration !== undefined) this.restoration.start(entry, force);
    else if (force || entry.snapshot.status === 'idle' || entry.snapshot.status === 'error') {
      entry.start(force).catch(() => {});
    }
    return entry;
  }

  readonly settleTimeoutMs = 5000;

  *pending(): Iterable<Promise<unknown>> {
    for (const entry of this.allEntries) {
      if (entry.request !== null) yield entry.request;
    }
  }

  clear(): void {
    for (const entry of [...this.allEntries]) entry.dispose(true);
    this.entries.clear();
    this.allEntries.clear();
    this.restoration?.clear();
  }
}

class ResourceController<T> {
  updates: LiveStamp[] = [];
  snapshot: MutableSnapshot<T> = initialSnapshot();
  entry: FetchEntry | null = null;
  disposed = false;
  private removeSignalListener: (() => void) | null = null;
  readonly notifier = new SnapshotNotifier(() => publicSnapshot(this.snapshot));
  operationId = createRequestId();

  constructor(
    readonly store: FetchStore,
    descriptor: FetchDescriptor,
    paused = false,
  ) {
    this.descriptor = descriptor;
    this.paused = paused;
    this.snapshot = initialSnapshot<T>(paused);

    if (!this.bindSignal(descriptor.signal)) {
      return;
    }

    if (!paused) {
      this.attach(false);
    }
  }

  descriptor: FetchDescriptor;
  paused: boolean;

  /** Shared by initial construction and optional request replay. */
  bindSignal(signal: AbortSignal | undefined): boolean {
    this.removeSignalListener?.();
    this.removeSignalListener = null;
    if (signal !== undefined) {
      const abort = () => this.abort(abortReason(signal));
      if (signal.aborted) return false;
      signal.addEventListener('abort', abort, { once: true });
      this.removeSignalListener = () =>
        signal.removeEventListener('abort', abort);
    }
    return true;
  }

  attach(force: boolean, replace = false): void {
    if (this.disposed) {
      throw new Error('Cannot refresh a disposed fetch resource');
    }
    this.entry = this.store.acquire(
      this.descriptor,
      this as ResourceController<unknown>,
      force,
      replace,
    );
  }

  /**
   * Payload kept from before a rebind (`/api/s/${id}` with a new id) until the
   * new request has data, so changing an input refreshes instead of blanking.
   */
  private previous: { data: T } | null = null;

  /**
   * Keep the current payload visible across a rebind to another request. A
   * paused (`null`) target clears it: there is no request to refresh.
   */
  retainForRebind(paused: boolean): void {
    this.previous = !paused && this.snapshot.status === 'success'
      ? { data: this.snapshot.data as T }
      : null;
  }

  receive(entry: FetchEntry, snapshot: MutableSnapshot<unknown>): void {
    if (this.entry !== null && this.entry !== entry) return;
    this.operationId = entry.operationId;
    this.updates = entry.updates;
    if (this.previous !== null && snapshot.status !== 'success') {
      // The new request has no data yet: it refreshes what is on screen. A
      // failure keeps that data visible with the error, as a refresh does.
      const inFlight = snapshot.pending || snapshot.refreshing;
      this.snapshot = {
        ...snapshot,
        data: this.previous.data,
        status: 'success',
        pending: false,
        refreshing: inFlight,
      } as MutableSnapshot<T>;
    } else {
      if (snapshot.status === 'success') this.previous = null;
      this.snapshot = { ...snapshot } as MutableSnapshot<T>;
    }
    this.notify();
  }

  detachFrom(entry: FetchEntry, reset = false): void {
    if (this.entry !== entry) return;
    this.entry = null;
    if (reset) {
      this.snapshot = initialSnapshot();
      this.notify();
    }
  }

  notify(): void {
    this.notifier.notify();
  }

  refresh(): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('Cannot refresh a disposed fetch resource'));
    }
    if (this.paused) {
      return Promise.reject(
        new TypeError('Cannot refresh a fetch resource with a null target'),
      );
    }
    const signal = this.descriptor.signal;
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.entry === null) {
      this.operationId = createRequestId();
      this.attach(true);
    } else if (this.entry.request === null) {
      this.operationId = createRequestId();
    }
    const request = this.entry!.start(true) as Promise<T>;
    return signal === undefined
      ? request
      : abortable(() => request, signal);
  }

  abort(reason?: unknown): void {
    if (this.disposed) throw new Error('Cannot abort a disposed fetch resource');
    this.detach(true, reason);
  }

  private detach(notify: boolean, reason?: unknown): void {
    const entry = this.entry;
    if (entry !== null) {
      this.entry = null;
      entry.remove(this as ResourceController<unknown>, reason);
    }
    this.snapshot.pending = false;
    this.snapshot.refreshing = false;
    if (this.descriptor.stream !== undefined) this.snapshot.streaming = false;
    this.snapshot.status =
      this.snapshot.status === 'success' ? 'success' : 'idle';
    this.snapshot.error = null;
    if (notify) this.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach(false);
    this.disposed = true;
    this.removeSignalListener?.();
    this.removeSignalListener = null;
    this.notifier.clear();
  }
}
const controllers = getGlobalControllers() as WeakMap<object, ResourceController<unknown>>;

export function createFetchResource<T>(
  store: FetchStore,
  environment: FetchEnvironment,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 },
): FetchResource<T> {
  const { descriptor, paused } = fetchDescriptor(
    environment,
    target,
    options,
  );
  return resourceObject(new ResourceController<T>(store, descriptor, paused));
}

function fetchDescriptor(
  environment: FetchEnvironment,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 },
): { descriptor: FetchDescriptor; paused: boolean } {
  const method = normalizeFetchMethod(options.method);
  const paused=target===null;
  if (!paused && method !== 'GET' && isSourceComputation() && !isEffectInvocation()) {
    throw new TypeError(`[memo-dom] ${method} actions must run from an event handler, effect or deferred callback`);
  }
  if (!paused && (method === 'GET' || method === 'HEAD') && options.body !== undefined) {
    throw new TypeError(`$fetch ${method} requests cannot include a body`);
  }
  const url = paused?'':resolveRequestURL(target, options.query, environment.baseURL);
  const headers = paused?options.headers:new Headers(options.headers);
  const body = paused ? undefined : options.body;
  if (body !== undefined && environment.prepareBody === undefined) {
    throw new TypeError('Request body encoding is not installed');
  }
  const preparedBody = body === undefined ? {body:undefined,identity:'none'}
    : environment.prepareBody!(body, headers as Headers);
  const key = options.key;
  const schema = options.validate;
  // Snapshot URL objects even when transfer support is installed later.
  const transferTarget = target instanceof URL ? url : target;
  let transferIdentity: string | null | undefined;
  const descriptor: FetchDescriptor = {
    url,
    method,
    headers,
    body: preparedBody.body,
    bodyIdentity: preparedBody.identity,
    identity: paused?'paused':fetchIdentity(
      url,
      method,
      headers,
      preparedBody.identity,
      key,
      schema,
    ) + (options.stream === undefined ? '' : `|stream:${options.stream}`),
    get transferIdentity() {
      if (transferTarget === null || environment.transferIdentity === undefined) return null;
      if (transferIdentity === undefined) {
        const identity = environment.transferIdentity(transferTarget, url, method,
          headers as Headers, preparedBody.identity, key, schema);
        transferIdentity = options.stream === undefined ? identity : `${identity}|stream:${options.stream}`;
      }
      return transferIdentity;
    },
    cache: normalizedCache(options.cache, method),
    schema,
    stream: options.stream,
    signal: options.signal,
  };
  return { descriptor, paused };
}

function resourceObject<T>(
  controller: ResourceController<T>,
): FetchResource<T> {
  const resource = {
    get data() { return controller.snapshot.data; },
    get error() { return controller.snapshot.error; },
    get status() { return controller.snapshot.status; },
    get pending() { return controller.snapshot.pending; },
    get refreshing() { return controller.snapshot.refreshing; },
    refresh: () => controller.refresh(),
    abort: () => controller.abort(),
    update: (change: (current: T | undefined) => T) =>
      dispatchResourceWrite(resource, change, false),
    mutate: (change: (current: T | undefined) => void) =>
      dispatchResourceWrite(resource, change, true),
  };
  controllers.set(resource, controller as ResourceController<unknown>);
  return resource as unknown as FetchResource<T>;
}

export function resourceController<T>(
  resource: FetchResource<T>,
): ResourceController<T> {
  const controller = controllers.get(resource);
  if (controller === undefined) {
    throw new TypeError('Value is not a fetch resource from @memoized-dom/data');
  }
  return controller as ResourceController<T>;
}

export function fetchResourceUpdates(resource: unknown): readonly LiveStamp[] {
  return typeof resource === 'object' && resource !== null ? controllers.get(resource)?.updates ?? [] : [];
}

export function fetchResourceIsFiniteStream(resource: unknown): boolean {
  const mode = typeof resource === 'object' && resource !== null ? controllers.get(resource)?.descriptor.stream : undefined;
  return mode === 'generator' || mode === 'page';
}

/** Internal capability check used by cross-runtime availability adapters. */
export function isFetchResource(value: unknown): value is FetchResource<unknown> {
  return typeof value === 'object' && value !== null &&
    (controllers.has(value) || isReadResource(value) || isFormSource(value));
}

export function fetchResourceIsLive(resource: FetchResource<unknown>): boolean {
  if (isReadResource(resource)) return readResourceIsLive(resource);
  if (isFormSource(resource)) return true;

  return !resourceController(resource).disposed;
}

export function subscribeFetchResource<T>(
  resource: FetchResource<T>,
  listener: ResourceListener<T>,
): () => void {
  if (isFormSource(resource)) {
    return subscribeFormSource(resource, listener as unknown as ResourceListener<FormSource<unknown>>);
  }
  if (isReadResource(resource)) return subscribeReadResource(resource, listener);
  const controller = resourceController(resource);
  if (controller.disposed) {
    throw new Error('Cannot subscribe to a disposed fetch resource');
  }
  return controller.notifier.subscribe(listener);
}

export function disposeFetchResource<T>(resource: FetchResource<T>): void {
  if (isFormSource(resource)) return disposeFormSource(resource);
  if (isReadResource(resource)) return disposeReadResource(resource);
  resourceController(resource).dispose();
}

/** @internal Owned holders retire with their staged component; borrowed
 * holders survive and need an explicit retry before a fresh render generation. */
export function retryFetchResourceIfLive<T>(resource: FetchResource<T>): Promise<unknown> {
  if (isFormSource(resource)) return Promise.resolve();
  if (isReadResource(resource)) {
    return readResourceIsLive(resource) ? resource.refresh() : Promise.resolve();
  }
  return resourceController(resource).disposed ? Promise.resolve() : resource.refresh();
}

/** Rebind one stable resource when compiler-tracked request inputs change. */
export function rebindFetchResource<T>(
  resource: FetchResource<T>,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 } = {},
): void {
  const controller = resourceController(resource);
  const { descriptor, paused } = fetchDescriptor(controller.store.environment, target, options);
  if (controller.disposed) {
    throw new Error('Cannot rebind a disposed fetch resource');
  }
  const unchanged =
    controller.paused === paused &&
    equalDescriptor(controller.descriptor, descriptor);
  if (unchanged) return;

  controller.operationId = createRequestId();

  const replaceSharedIdentity =
    !paused &&
    controller.descriptor.identity === descriptor.identity;
  const previous = controller.entry;
  if (previous !== null) {
    controller.entry = null;
    previous.remove(controller as ResourceController<unknown>);
  }
  controller.descriptor = descriptor;
  controller.paused = paused;
  controller.retainForRebind(paused);
  controller.snapshot = initialSnapshot(paused);

  if (!controller.bindSignal(descriptor.signal) || paused) {
    controller.notify();
    return;
  }
  controller.attach(false, replaceSharedIdentity);
}

/**
 * Move a freshly-created source behind this stable public resource. Imported
 * colorless factories own their argument-to-request mapping, so compiler
 * replay adopts their result instead of interpreting those arguments as a
 * raw fetch URL and options tuple.
 */
export function rebindFetchResourceFrom<T>(
  resource: FetchResource<T>,
  candidate: FetchResource<T>,
): void {
  if (isReadResource(resource) && isReadResource(candidate)) {
    adoptReadResource(resource, candidate);
    return;
  }
  const controller = resourceController(resource);
  const incoming = resourceController(candidate);
  if (incoming === controller) return;
  if (controller.disposed || incoming.disposed) {
    throw new Error('Cannot rebind a disposed fetch resource');
  }
  if (incoming.store !== controller.store) {
    incoming.dispose();
    throw new TypeError('Cannot rebind fetch resources from different data runtimes');
  }

  const unchanged =
    controller.paused === incoming.paused &&
    equalDescriptor(controller.descriptor, incoming.descriptor);
  if (unchanged) {
    incoming.dispose();
    return;
  }

  controller.operationId = incoming.operationId;

  const previous = controller.entry;
  if (previous !== null) {
    controller.entry = null;
    previous.remove(controller as ResourceController<unknown>);
  }
  controller.descriptor = incoming.descriptor;
  controller.paused = incoming.paused;
  controller.retainForRebind(controller.paused);
  controller.snapshot = initialSnapshot(controller.paused);

  if (!controller.bindSignal(controller.descriptor.signal) || controller.paused) {
    incoming.dispose();
    controller.notify();
    return;
  }

  const next = incoming.entry;
  if (next === null) {
    incoming.dispose();
    controller.notify();
    return;
  }

  // Attach the stable consumer before removing the temporary one. This is
  // essential for cache:false requests: dropping the last consumer aborts
  // the in-flight request.
  controller.entry = next;
  next.add(controller as ResourceController<unknown>);
  next.remove(incoming as ResourceController<unknown>);
  incoming.entry = null;
  incoming.dispose();
}

export function fetchResourceSnapshot<T>(
  resource: FetchResource<T>,
): ResourceSnapshot<T> {
  if (isFormSource(resource)) return formSourceSnapshot(resource) as ResourceSnapshot<T>;
  if (isReadResource(resource)) return readResourceSnapshot(resource);
  return publicSnapshot(resourceController(resource).snapshot);
}

/** Identity of the current execution behind one hidden fetch resource. */
export function fetchResourceOperationId<T>(
  resource: FetchResource<T>,
): string {
  if (isFormSource(resource)) return formSourceOperationId(resource);
  if (isReadResource(resource)) return readResourceOperationId(resource);
  return resourceController(resource).operationId;
}

export function createFetchEnvironment(
  fetcher: import('./types').DataRuntimeOptions['fetch'],
  baseURL: string | URL | undefined,
): FetchEnvironment {
  const resolvedBaseURL = baseURL ?? (
    typeof location === 'undefined' ? undefined : location.href
  );
  return {
    baseURL: resolvedBaseURL,
    fetch() {
      const implementation = fetcher ?? globalThis.fetch;
      if (implementation === undefined) {
        throw new Error('No fetch implementation is available');
      }
      return implementation;
    },
  };
}
