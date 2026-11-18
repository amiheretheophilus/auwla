import { serve } from '@memoized-dom/server';
import { define } from './server/define';
import { databaseIsReady } from './server/database';
import { authRoutes, leaveDesk } from './server/auth/routes';
import { App } from './src/App.auwla';

const app = serve({ define });

app.get('/healthz', () => Response.json({ ok: true }, {
  headers: { 'Cache-Control': 'no-store' },
}));

app.get('/readyz', async () => {
  const ready = await databaseIsReady();

  return Response.json({ ok: ready }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
});

const privateResponse = define.middleware(async (_context, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, headers });
});

app.use('/desk', privateResponse);
app.use('/desk/sign-in', privateResponse);
app.use('/_memoized/routed', privateResponse);
app.use('/_fn/desk/*', privateResponse);
app.post('/api/auth/*', ({ request }) => authRoutes.fetch(request));
app.post('/desk/sign-out', ({ request }) => leaveDesk(request));

app.ssr('/', App);
app.ssr('/desk', App, { delivery: 'buffer' });
app.ssr('/desk/sign-in', App, { delivery: 'buffer' });

export default app;
