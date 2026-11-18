import { fileURLToPath } from 'node:url';
import { serverPreview } from '../server-preview';

const folder = new URL('./', import.meta.url);
process.env.DRAFTROOM_ROOT = fileURLToPath(folder);
const port = process.env.AUWLA_EXAMPLE_PORT ?? '3065';

await serverPreview(folder, `Draftroom ${port}`, 3065, {
  client: './main.ts',
  entryName: 'draftroom',
  minify: true,
  // The editor shell and read-only HTML are served by named routes in server.ts.
  delivery: 'export default { document: () => undefined, assets: () => undefined };',
});
