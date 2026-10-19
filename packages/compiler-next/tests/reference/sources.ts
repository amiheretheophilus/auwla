/** Test-only source state and readiness. No compiler or production data runtime. */
import type { FetchOptions } from '@memoized-dom/data';

export const Group = Symbol('reference Group');

export class RequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'promise' | 'network' | 'http' | 'decode',
    readonly status: number | null = null,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

let nextId = 0;
let transport: typeof fetch;
let ownedSources = new Set<Source>();
let moduleDeclarations = false;
let fetches = new Map<string, Source>();
let sourceOwner: Set<Source> | undefined;

/** Component-owned work survives preparation, and is released when that owner leaves. */
export function enterSourceOwner(owner: Set<Source>): () => void {
  const previous = sourceOwner;
  sourceOwner = owner;
  return () => { sourceOwner = previous; };
}

/** Each comparison run owns its sources, including declarations at module scope. */
export function beginSources(fetcher: typeof fetch): () => void {
  const previousTransport = transport;
  const previousSources = ownedSources;
  const previousFetches = fetches;
  const sources = new Set<Source>();
  transport = fetcher;
  ownedSources = sources;
  fetches = new Map();
  moduleDeclarations = true;
  return () => {
    for (const source of sources) source.dispose();
    transport = previousTransport;
    ownedSources = previousSources;
    fetches = previousFetches;
    moduleDeclarations = false;
  };
}

export function finishSourceDeclarations(): void {
  moduleDeclarations = false;
}

export class Source {
  readonly id = ++nextId;
  version = 0;
  status: 'idle' | 'pending' | 'success' | 'error' = 'idle';
  data: unknown;
  hasValue = false;
  error: RequestError | null = null;
  private generation = 0;
  private disposed = false;
  private controller: AbortController | undefined;
  private readonly owners = new Set<Set<Source>>();
  private readonly moduleOwned = moduleDeclarations;

  constructor(private readonly load: (signal: AbortSignal) => PromiseLike<unknown>, first?: PromiseLike<unknown>, lazy = false) {
    ownedSources.add(this);
    this.claim();
    if (!lazy) void this.start(first);
  }

  get isDisposed(): boolean { return this.disposed; }

  claim(): void {
    if (!sourceOwner) return;
    sourceOwner.add(this);
    this.owners.add(sourceOwner);
  }

  release(owner: Set<Source>): void {
    this.owners.delete(owner);
    if (!this.moduleOwned && this.owners.size === 0) this.dispose();
  }

  ensureStarted(): void {
    if (this.status === 'idle') void this.start();
  }

  get executionId(): string {
    return `${this.id}:${this.generation}`;
  }

  get pending(): boolean {
    return !this.hasValue && this.status === 'pending';
  }

  get refreshing(): boolean {
    return this.hasValue && this.status === 'pending';
  }

  refresh(): Promise<unknown> {
    return this.start();
  }

  private start(first?: PromiseLike<unknown>): Promise<unknown> {
    this.controller?.abort();
    this.controller = new AbortController();
    const generation = ++this.generation;
    this.status = 'pending';
    this.error = null;
    this.version++;
    const work = Promise.resolve(first ?? this.load(this.controller.signal)).then(
      (data) => {
        if (!this.disposed && generation === this.generation) {
          this.data = data;
          this.hasValue = true;
          this.status = 'success';
          this.version++;
        }
        return data;
      },
      (cause) => {
        const error = cause instanceof RequestError
          ? cause
          : new RequestError(cause instanceof Error ? cause.message : String(cause), 'promise', null, cause);
        if (!this.disposed && generation === this.generation) {
          this.error = error;
          this.status = 'error';
          this.version++;
        }
        throw error;
      },
    );
    // Status consumers need no promise handler; explicit awaiters still reject.
    void work.then(undefined, () => undefined);
    return work;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
  }
}

/** A computation that could not run. Its dependencies retain pending/error state. */
export class Waiting {
  constructor(readonly sources: readonly Source[]) {}
}

export function $waiting(values: readonly unknown[]): Waiting | undefined {
  const sources = new Set<Source>();
  for (const value of values) {
    if (value instanceof Source) {
      value.claim();
      value.ensureStarted();
    }
    if (value instanceof Waiting) {
      for (const source of value.sources) sources.add(source);
    } else if (value instanceof Source && (!value.hasValue || value.error !== null)) {
      sources.add(value);
    }
  }
  return sources.size === 0 ? undefined : new Waiting([...sources]);
}

/** Evaluate authored code only when all of its inputs have values. */
export function $when(readInputs: () => unknown[], compute: () => unknown): unknown {
  return $waiting(readInputs()) ?? compute();
}

/** Called only inside a computation whose inputs were checked by `$when`. */
export function $value(value: unknown): any {
  if (value instanceof Waiting || (value instanceof Source && !value.hasValue)) {
    throw new Error('reference: an unguarded read reached a loading source');
  }
  return value instanceof Source ? value.data : value;
}

/** Status reads do not wait for the payload. Also used for memo input snapshots. */
export function $sourceState(value: unknown): unknown {
  if (value instanceof Source) {
    value.ensureStarted();
    return { id: value.id, version: value.version };
  }
  if (value instanceof Waiting) return value.sources.map($sourceState);
  return value;
}

export function $read(promise: PromiseLike<unknown>, replay?: () => PromiseLike<unknown>): Source {
  return new Source(replay ?? (() => promise), promise);
}

export function $fetch(target: string | URL | null, options?: FetchOptions): Source {
  if (target === null) return new Source(() => Promise.resolve(null));
  const url = new URL(String(target), window.location.href);
  for (const [name, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined) continue;
    for (const part of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(part));
  }
  const method = options?.method ?? 'GET';
  const headers = new Headers(options?.headers);
  let body = options?.body as BodyInit | null | undefined;
  if (body !== undefined && (body === null || typeof body === 'number' || typeof body === 'boolean'
    || Array.isArray(body) || Object.getPrototypeOf(body) === Object.prototype)) {
    body = JSON.stringify(body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  const key = JSON.stringify([method, url.href, [...headers], options?.key]);
  const shared = method === 'GET' && options?.cache !== false;
  const cached = shared ? fetches.get(key) : undefined;
  if (cached && !cached.isDisposed) {
    cached.claim();
    return cached;
  }
  const load = (signal: AbortSignal) => transport(url, {
    method, headers, body, signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
  }).then(
    (response) => response.json().then(
      (body) => {
        if (!response.ok) {
          const message = typeof body?.message === 'string' ? body.message : response.statusText;
          throw new RequestError(message, 'http', response.status, body);
        }
        return body;
      },
      (cause) => { throw new RequestError('Failed to decode response', 'decode', response.status, cause); },
    ),
    (cause) => { throw new RequestError('Network request failed', 'network', null, cause); },
  );
  const source = new Source(load, undefined, moduleDeclarations);
  if (shared) fetches.set(key, source);
  return source;
}

export function $track(source: Source) {
  if (!(source instanceof Source)) throw new Error('reference: $track expects a source');
  return {
    get id() { return source.executionId; },
    get status() { return source.status; },
    get pending() { return source.pending; },
    get refreshing() { return source.refreshing; },
    get error() { return source.error; },
    refresh: () => source.refresh(),
  };
}
