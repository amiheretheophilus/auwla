import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { createDefine, serve } from '@memoized-dom/server';
import { sharedDocument } from '#server/SharedFrame.auwla';
import { loadShare, loadSharedImage, saveShare } from '#server/share-store';

const app = serve({ define: createDefine() });
const styles = new Set(['workspace.css', 'controls.css', 'inspector.css', 'board.css', 'features.css', 'shared.css']);
const fileHeaders = { 'X-Content-Type-Options': 'nosniff' };
const htmlHeaders = { ...fileHeaders, 'Content-Type': 'text/html; charset=utf-8' };
const root = process.env.DRAFTROOM_ROOT ?? process.cwd();

app.get('/', async () => {
  const shell = await readFile(join(root, 'index.html'), 'utf8');
  return new Response(shell.replace('./main.ts', '/draftroom.js'), { headers: htmlHeaders });
});

app.get('/styles/:name', ({ params }) => {
  if (!styles.has(params.name)) return new Response('Not found', { status: 404 });

  return readFile(join(root, 'styles', params.name), 'utf8').then(
    css => new Response(css, { headers: { ...fileHeaders, 'Content-Type': 'text/css; charset=utf-8' } }),
    () => new Response('Not found', { status: 404 }),
  );
});

app.post('/api/shared-frames', ({ request }) => saveShare(request).then(
  frame => Response.json({ path: `/share/${frame.id}` }, { status: 201 }),
  () => Response.json({ message: 'Could not publish that frame' }, { status: 400 }),
));

app.get('/share/:id', async ({ params }) => {
  const entry = await loadShare(params.id);
  if (entry === undefined) return new Response('Frame not found', { status: 404 });

  return new Response(sharedDocument(entry), {
    headers: { ...htmlHeaders, 'Cache-Control': 'no-store' },
  });
});

app.get('/share/:id/image.png', async ({ params }) => {
  const bytes = await loadSharedImage(params.id);
  if (bytes === undefined) return new Response('Frame not found', { status: 404 });

  return new Response(new Blob([bytes]), {
    headers: { ...fileHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
  });
});

export default app;
