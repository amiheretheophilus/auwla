import { assetResolver, type AssetOptions } from './assets';

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** Worker assets are supplied by the host binding, rather than a filesystem. */
export function createAssetHandler(binding: () => AssetsBinding, options: AssetOptions) {
  const resolveAsset = assetResolver(options);
  const base = options.base ?? '/';
  return async (request: Request): Promise<Response | undefined> => {
    const asset = resolveAsset(request);
    if (asset === undefined) return undefined;
    const url = new URL(request.url);
    const file = asset?.file ?? decodeURIComponent(url.pathname).slice(base.length);
    // Additional Worker-imported chunks are moved into the client output after
    // the server build, so the assets binding can resolve these generated paths.
    if (file.split('/').some(segment => segment.startsWith('.'))) return new Response('Not Found', { status: 404 });
    url.pathname = '/' + file.split('/').map(encodeURIComponent).join('/');
    const response = await binding().fetch(new Request(url, request));
    if (response.status === 404) return new Response('Not Found', { status: 404 });
    const headers = new Headers(response.headers);
    if (asset) for (const [name, value] of asset.headers) headers.set(name, value);
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  };
}
