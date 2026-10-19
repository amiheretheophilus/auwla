/**
 * Sources for the test reference: `$fetch`, `$read`, `$track` and `Group`.
 *
 * Test-only. It is written from `docs/05-data.md` and `docs/06-group.md`, and
 * shares no code with the compiler or the production data runtime, so the two
 * cannot agree on a mistake by sharing it.
 *
 * A source is a value that loads over time. Code that reads a source's payload
 * waits until the payload exists: `$when` checks the inputs first, and returns a
 * `Waiting` value instead of running the authored code too early.
 */
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

// ---------------------------------------------------------------------------
// Ownership: which run, and which component instance, a source belongs to

let nextId = 0;
let transport: typeof fetch;
let ownedSources = new Set<Source>();
/** True while a case's modules are evaluated: sources made then belong to the module. */
let moduleDeclarations = false;
/** Shared GET sources, by method, URL, headers and key. */
let fetches = new Map<string, Source>();
/** The component instance being rendered; it owns the sources it creates or reads. */
let sourceOwner: Set<Source> | undefined;

/** Component-owned work survives preparation, and is released when that owner leaves. */
export function enterSourceOwner(owner: Set<Source>): () => void {
  const previous = sourceOwner;
  sourceOwner = owner;
  return () => {
    sourceOwner = previous;
  };
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

// ---------------------------------------------------------------------------
// Source

export class Source {
  readonly id = ++nextId;
  /** Changes whenever status, payload or error changes. Memo inputs compare it. */
  version = 0;
  status: 'idle' | 'pending' | 'success' | 'error' = 'idle';
  data: unknown;
  hasValue = false;
  error: RequestError | null = null;
  /**
   * It took the place of a source that had loaded, in the same binding (a new
   * request after an input change, or a reassignment). Sites keep showing what
   * they showed while it loads: "an input change is a refresh, not a new initial
   * load" (`docs/05-data.md`).
   */
  replacesLoaded = false;

  /** Counts requests. Only the latest request may commit (the latest input wins). */
  private generation = 0;
  private disposed = false;
  private controller: AbortController | undefined;
  private readonly owners = new Set<Set<Source>>();
  private readonly moduleOwned = moduleDeclarations;

  constructor(
    private readonly load: (signal: AbortSignal) => PromiseLike<unknown>,
    first?: PromiseLike<unknown>,
    lazy = false,
  ) {
    ownedSources.add(this);
    this.claim();
    if (!lazy) void this.start(first);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  claim(): void {
    if (!sourceOwner) return;
    sourceOwner.add(this);
    this.owners.add(sourceOwner);
  }

  /** A component source with no owner left is disposed. Module sources stay. */
  release(owner: Set<Source>): void {
    this.owners.delete(owner);
    if (!this.moduleOwned && this.owners.size === 0) this.dispose();
  }

  /** A lazy module `$fetch` starts when something first reads it. */
  ensureStarted(): void {
    if (this.status === 'idle') void this.start();
  }

  /** `$track(source).id`: one id per request. */
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

  /** A payload known without a request: `$fetch(null)` is `null` at once. */
  settle(data: unknown): void {
    this.data = data;
    this.hasValue = true;
    this.status = 'success';
    this.version++;
  }

  private start(first?: PromiseLike<unknown>): Promise<unknown> {
    this.controller?.abort();
    this.controller = new AbortController();
    const generation = ++this.generation;
    this.status = 'pending';
    this.error = null;
    this.version++;

    const isLatest = () => !this.disposed && generation === this.generation;
    const loading = first ?? this.load(this.controller.signal);

    const work = Promise.resolve(loading).then(
      (data) => {
        if (isLatest()) this.settle(data);
        return data;
      },
      (cause) => {
        const error = toRequestError(cause);
        if (isLatest()) {
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

function toRequestError(cause: unknown): RequestError {
  if (cause instanceof RequestError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new RequestError(message, 'promise', null, cause);
}

// ---------------------------------------------------------------------------
// Readiness

/** A computation that could not run. Its sources say whether it is pending or failed. */
export class Waiting {
  constructor(readonly sources: readonly Source[]) {}

  /** Every source it waits for replaces a loaded one: old content stays on screen. */
  get replacing(): boolean {
    return this.sources.every((source) => source.replacesLoaded);
  }
}

/** A binding's value changed from `previous` to `next`. */
export function noteReplacement(previous: unknown, next: unknown): void {
  if (!(previous instanceof Source) || !(next instanceof Source) || previous === next) return;
  if (previous.hasValue || previous.replacesLoaded) next.replacesLoaded = true;
}

/** The sources among `values` that have no payload yet, or failed. `undefined` when all are ready. */
export function $waiting(values: readonly unknown[]): Waiting | undefined {
  const sources = new Set<Source>();

  for (const value of values) {
    if (value instanceof Source) {
      value.claim();
      value.ensureStarted();
      if (!value.hasValue || value.error !== null) sources.add(value);
    }
    if (value instanceof Waiting) {
      for (const source of value.sources) sources.add(source);
    }
  }

  return sources.size === 0 ? undefined : new Waiting([...sources]);
}

/** Evaluate authored code only when all of its inputs have values. */
export function $when(readInputs: () => unknown[], compute: () => unknown): unknown {
  return $waiting(readInputs()) ?? compute();
}

/**
 * The inputs of `a ? b : c`, `a && b`, `a || b` and `a ?? b`, as JavaScript would
 * read them: the test's inputs, then those of the branch that runs. An unchosen
 * branch never makes the expression wait.
 *
 * Limit of the reference: the test is evaluated here and again by the authored
 * expression, so a test with side effects runs twice.
 */
export function $branch(
  operator: '?' | '&&' | '||' | '??',
  readTest: () => unknown[],
  test: () => unknown,
  readFirst: () => unknown[],
  readSecond: () => unknown[] = () => [],
): unknown[] {
  const testInputs = readTest();
  if ($waiting(testInputs)) return testInputs;

  const value = test();
  let first: boolean;
  if (operator === '?' || operator === '&&') {
    first = Boolean(value);
  } else if (operator === '||') {
    first = !value;
  } else {
    first = value === null || value === undefined;
  }
  return [...testInputs, ...(first ? readFirst() : readSecond())];
}

/**
 * `props.user.name` as an input: follows the path through plain data and stops at
 * a loading value, so `$waiting` finds a source a parent passed inside an object.
 * Reads only data properties of plain objects and arrays: never a getter.
 */
export function $path(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (current instanceof Waiting || current instanceof Source) return current;
    if (!isPlainData(current)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    current = descriptor.value;
  }
  return current;
}

function isPlainData(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The payload of a source. Only called inside a computation `$when` already checked. */
export function $value(value: unknown): any {
  const notReady = value instanceof Waiting || (value instanceof Source && !value.hasValue);
  if (notReady) throw new Error('reference: an unguarded read reached a loading source');
  return value instanceof Source ? value.data : value;
}

/** Status reads (`$track`) do not wait for the payload. Also used for memo input snapshots. */
export function $sourceState(value: unknown): unknown {
  if (value instanceof Source) {
    value.ensureStarted();
    return { id: value.id, version: value.version };
  }
  if (value instanceof Waiting) return value.sources.map($sourceState);
  return value;
}

// ---------------------------------------------------------------------------
// The public APIs

/** `$read(promise)`. `replay` makes the promise again for `refresh()`. */
export function $read(promise: PromiseLike<unknown>, replay?: () => PromiseLike<unknown>): Source {
  return new Source(replay ?? (() => promise), promise);
}

export function $fetch(target: string | URL | null, options?: FetchOptions): Source {
  // "Changing the target to `null` pauses the request and clears the payload."
  if (target === null) {
    const paused = new Source(() => Promise.resolve(null), undefined, true);
    paused.settle(null);
    return paused;
  }

  const url = new URL(String(target), window.location.href);
  for (const [name, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined) continue;
    for (const part of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(name, String(part));
    }
  }

  const method = options?.method ?? 'GET';
  const headers = new Headers(options?.headers);
  let body = options?.body as BodyInit | null | undefined;
  if (body !== undefined && isJsonBody(body)) {
    body = JSON.stringify(body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  // Matching GET requests share one source.
  const key = JSON.stringify([method, url.href, [...headers], options?.key]);
  const shared = method === 'GET' && options?.cache !== false;
  const cached = shared ? fetches.get(key) : undefined;
  if (cached && !cached.isDisposed) {
    cached.claim();
    return cached;
  }

  const load = (signal: AbortSignal) => {
    const signals = options?.signal ? AbortSignal.any([signal, options.signal]) : signal;
    return transport(url, { method, headers, body, signal: signals }).then(
      decodeResponse,
      (cause) => {
        throw new RequestError('Network request failed', 'network', null, cause);
      },
    );
  };

  // A module-level `$fetch` starts when something first reads it.
  const source = new Source(load, undefined, moduleDeclarations);
  if (shared) fetches.set(key, source);
  return source;
}

function isJsonBody(body: unknown): boolean {
  if (body === null || typeof body === 'number' || typeof body === 'boolean') return true;
  return Array.isArray(body) || Object.getPrototypeOf(body) === Object.prototype;
}

function decodeResponse(response: Response): Promise<unknown> {
  return response.json().then(
    (body) => {
      if (!response.ok) {
        const message = typeof body?.message === 'string' ? body.message : response.statusText;
        throw new RequestError(message, 'http', response.status, body);
      }
      return body;
    },
    (cause) => {
      throw new RequestError('Failed to decode response', 'decode', response.status, cause);
    },
  );
}

export function $track(source: Source) {
  if (!(source instanceof Source)) throw new Error('reference: $track expects a source');
  return {
    get id() {
      return source.executionId;
    },
    get status() {
      return source.status;
    },
    get pending() {
      return source.pending;
    },
    get refreshing() {
      return source.refreshing;
    },
    get error() {
      return source.error;
    },
    refresh: () => source.refresh(),
  };
}
