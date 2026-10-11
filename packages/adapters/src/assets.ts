export interface AssetOptions {
  readonly files: readonly string[];
  readonly base?: string;
  readonly assetsDir?: string;
}

const mimeTypes: Readonly<Record<string, string>> = {
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm', map: 'application/json; charset=utf-8',
};

/** Only serve files declared by the build; HTML is always application-owned. */
export function assetResolver(options: AssetOptions) {
  const files = new Set(options.files.filter(file => !file.endsWith('.html') &&
    !file.split('/').some(segment => segment.startsWith('.'))));
  const base = options.base ?? '/';
  const assetsDir = (options.assetsDir ?? 'assets').replace(/\/$/, '') + '/';
  if (!base.startsWith('/') || !base.endsWith('/')) throw new TypeError('Asset base must be an absolute URL path ending in /');
  return (request: Request): { file: string; headers: Headers } | null | undefined => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return undefined; }
    if (!pathname.startsWith(base)) return undefined;
    const file = pathname.slice(base.length);
    if (!files.has(file)) return file.startsWith(assetsDir) ? null : undefined;
    const headers = new Headers({
      'content-type': mimeTypes[file.split('.').at(-1)!.toLowerCase()] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': file.startsWith(assetsDir) && /-[\w-]{8,}\.[^.]+$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    return { file, headers };
  };
}
