import type { WebHandler } from './index';
import { assetResolver, type AssetOptions } from './assets';

export type BunFetch = (request: Request) => Response | Promise<Response>;

/**
 * Bun.serve already speaks Web Request/Response; this adapter preserves the
 * common handler contract while normalizing synchronous handlers to promises.
 */
export function createBunFetch(handler: WebHandler): BunFetch {
  return (request) => handler(request);
}

/** Generated production integration: native file responses without static middleware. */
export function createAssetHandler(root: URL, options: AssetOptions) {
  const resolveAsset = assetResolver(options);
  return async (request: Request): Promise<Response | undefined> => {
    const asset = resolveAsset(request);
    if (asset === undefined) return undefined;
    if (asset === null) return new Response('Not Found', { status: 404 });
    const file = Bun.file(new URL(asset.file.split('/').map(encodeURIComponent).join('/'), root));
    if (!await file.exists()) return new Response('Not Found', { status: 404 });
    asset.headers.set('content-length', String(file.size));
    return new Response(request.method === 'HEAD' ? null : file, { headers: asset.headers });
  };
}
