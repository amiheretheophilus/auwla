/**
 * A local preview of the server pages example, rendered on the server (`../server-preview.ts`).
 * `--build` builds, writes `.memoized/server-functions.d.ts`, reports the bundle and exits.
 */
import { serverPreview } from '../server-preview';

await serverPreview(new URL('./', import.meta.url), 'Server pages', 3038, {
  // The browser's entry: the root component's own file, which mounts it.
  client: './src/App.auwla',
  // `app.js`, and `app.css` with the shell's styles.
  entryName: 'app',
  minify: true,
  // The shell's styles come from `app.css`; each server page brings its own with its HTML.
  delivery: `export default {
  document: () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Projects</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/app.js"></script></body></html>',
  assets: () => undefined,
};`,
});
