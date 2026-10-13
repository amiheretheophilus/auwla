import { define } from '../define';

/**
 * Application-scoped runtime dependencies. A real app can connect its
 * database, queue, cache, or repositories here; serve() initializes this
 * factory lazily once for each application instance.
 */
export const database = define.service('database', async () => ({
  name: 'fullstack-demo',
  status: (): 'ready' => 'ready',
}));
