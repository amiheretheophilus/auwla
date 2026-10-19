/** Deterministic transport shared by the reference and compiled runs. */
interface PendingRequest {
  url: string;
  resolve(response: Response): void;
  reject(error: Error): void;
}

const pending: PendingRequest[] = [];
const history: string[] = [];

export const fetchForCase: typeof fetch = ((input: string | URL | Request) => {
  const url = requestUrl(input instanceof Request ? input.url : String(input));
  history.push(url);
  return new Promise<Response>((resolve, reject) => pending.push({ url, resolve, reject }));
}) as typeof fetch;

/** Compare transport requests independently of the client's absolute-URL encoding. */
function requestUrl(input: string): string {
  const url = new URL(input, window.location.href);
  return url.origin === window.location.origin ? url.pathname + url.search : url.href;
}

export function requestedUrls(): readonly string[] {
  return [...history];
}

function take(url: string): PendingRequest {
  const target = requestUrl(url);
  const index = pending.findIndex((request) => request.url === target);
  if (index < 0) throw new Error(`case: no request is waiting for ${url}`);
  return pending.splice(index, 1)[0]!;
}

export function respond(url: string, value: unknown, status = 200): void {
  take(url).resolve(Response.json(value, { status }));
}

export function rejectRequest(url: string, message: string): void {
  take(url).reject(new Error(message));
}

export function clearRequests(): void {
  pending.length = 0;
  history.length = 0;
}
