import { serve } from '@memoized-dom/server';
import { define } from '#server/define';
import { App } from './src/App.auwla';

// Renders the app and answers its server functions, pages included.
const app = serve({ define });
app.ssr(App);

export default app;
