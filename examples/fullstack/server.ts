/** Fullstack server composition using the public serve() application API. */
import {
  serve,
} from '@memoized-dom/server';
import { Main } from './src/Main.tsx';
import { define } from '#server/define';
import { Hono } from 'hono';

let sequence = 0;

const logger = define.middleware(async (context, next) => {
  const response = await next();
  console.log(
    `[http] ${context.request.method} ${context.url.pathname} → ${response.status}`,
  );
  return response;
});

const session = define.middleware((context, next) => {
  context.state.user = context.request.headers.get('x-user') ?? undefined;
  return next();
});

const requireAdmin = define.middleware((context, next) => {
  if (context.request.headers.get('x-admin') !== 'yes') {
    return new Response('Admins only', { status: 403 });
  }
  return next();
});

const app = serve({
  define,
  state: () => ({ requestId: `req-${String(++sequence)}` }),
});

app.use(logger, session);
app.use('/api/admin/*', requireAdmin);

app.get('/api/health', context => ({
  ok: context.services.database.status() === 'ready',
  database: context.services.database.name,
}));
app.post('/api/echo', context => ({
  echoed: context.url.pathname,
  requestId: context.state.requestId,
}));
app.get('/api/admin/stats', context => ({
  admin: context.state.user ?? 'anonymous',
  requestId: context.state.requestId,
}));

app.ssr(Main, { mode: 'stream', nonce: request => request.headers.get('x-csp-nonce') ?? undefined });
const backend = new Hono();
backend.get('/api/backend', context => context.json({ backend: 'hono' }));
backend.all('*', context => app.fetch(context.req.raw, { platform: context.env }));
export default backend;
