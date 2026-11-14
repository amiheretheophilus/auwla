import { serve } from '@memoized-dom/server';
import { define } from '#server/define';
import { api } from '#server/status';
import { App } from './src/App.auwla';

// Renders every page of the app and answers its server functions and `$routed` requests.
const app = serve({ define });
// Ordinary backend routes, written with Hono in `server/status.auwla`.
app.get('/api/status', (context) => api.fetch(context.request));
app.ssr(App);

export default app;
