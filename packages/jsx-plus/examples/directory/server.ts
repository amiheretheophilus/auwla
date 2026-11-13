import { serve } from '@memoized-dom/server';
import { define } from '#server/define';
import { App } from './src/App.auwla';

// Renders every page of the app and answers its server functions and `$routed` requests.
const app = serve({ define });
app.ssr(App);

export default app;
