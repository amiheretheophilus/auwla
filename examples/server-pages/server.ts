import { serve } from '@memoized-dom/server';
import { define } from './server/define';
import { App } from './src/App';

const app = serve({ define });
app.ssr('/', App, { mode: 'stream' });
export default app;
