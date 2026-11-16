/**
 * A local preview of the directory example, rendered on the server (`../server-preview.ts`).
 * `--build` builds, writes `.memoized/server-functions.d.ts` and exits.
 */
import { serverPreview } from '../server-preview';

await serverPreview(new URL('./', import.meta.url), 'Directory', 3033, {
  client: './src/main.ts',
  entryName: 'main',
  delivery: `export default {
  document: () => '<!doctype html><html><head><meta charset="utf-8"><title>Directory</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.js"></script></body></html>',
  assets: () => undefined,
};`,
});
