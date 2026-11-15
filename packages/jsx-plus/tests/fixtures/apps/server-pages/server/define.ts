import { createDefine } from '@memoized-dom/server';

/** Creates the server functions of this app. */
export const define = createDefine();
// Server functions take `page` from here; the build follows the re-export to the framework's.
export { page } from '@memoized-dom/server';
