import { serve } from '@memoized-dom/server';
import { define, emptyRequestState } from './server/define';
import { databaseIsReady } from './server/database';
import { authRoutes, leaveDesk, leaveMembers } from './server/auth/routes';
import { App } from './src/App.auwla';

const app = serve({ define, state: emptyRequestState });

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

// The landing and pricing pages show who is signed in, in their header and plan buttons, so their
// HTML is personal too. A path middleware matches everything under it, and '/' would take every
// asset with it, so these two exact paths are checked here instead.
const personalPages = new Set(['/', '/pricing']);
app.use(define.middleware(async (context, next) => {
  const response = await next();
  if (!personalPages.has(new URL(context.request.url).pathname)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, headers });
}));

app.use('/desk', privateResponse);
app.use('/desk/sign-in', privateResponse);
app.use('/signals', privateResponse);
app.use('/subscribe', privateResponse);
app.use('/sign-in', privateResponse);
app.use('/sign-up', privateResponse);
app.use('/_memoized/routed', privateResponse);
app.use('/_fn/desk/*', privateResponse);
app.use('/_fn/members/*', privateResponse);
app.use('/_fn/payments/*', privateResponse);
app.post('/api/auth/*', ({ request }) => authRoutes.fetch(request));
app.post('/desk/sign-out', ({ request }) => leaveDesk(request));
app.post('/sign-out', ({ request }) => leaveMembers(request));

app.ssr('/', App);
app.ssr('/desk', App, { delivery: 'buffer' });
app.ssr('/desk/sign-in', App, { delivery: 'buffer' });
app.ssr('/desk/analyses/:id', App, { delivery: 'buffer' });
app.ssr('/desk/payments', App, { delivery: 'buffer' });
app.ssr('/pricing', App, { delivery: 'buffer' });
app.ssr('/sign-in', App, { delivery: 'buffer' });
app.ssr('/sign-up', App, { delivery: 'buffer' });
app.ssr('/signals', App, { delivery: 'buffer' });
app.ssr('/subscribe', App, { delivery: 'buffer' });

export default app;
