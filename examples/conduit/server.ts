import { serve } from '@memoized-dom/server';
import { Main } from './App';
import { define } from '#server/define';
import { session } from '#server/middleware';

const app = serve({ define, state: () => ({ user: null }) });

app.use(session);
app.ssr(Main);

export default app;
