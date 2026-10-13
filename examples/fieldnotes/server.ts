import { serve } from '@memoized-dom/server';
import { Main } from './App';
import { define } from '#server/define';
import { logger, session } from '#server/middleware';
import { delay } from '#server/latency';

let sequence = 0;

const app = serve({
  define,
  state: () => ({
    requestId: `req-${String(++sequence)}`,
    visitor: 'anonymous',
  }),
});

app.use(logger, session);

app.get('/api/health', async (context) => {
  await delay(500);
  return {
    ok: true,
    expeditions: context.services.expeditions.all().length,
  };
});

app.ssr(Main);

export default app;
