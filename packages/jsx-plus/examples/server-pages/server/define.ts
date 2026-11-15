import { createDefine } from '@memoized-dom/server';

/** Creates the server functions of this app. */
export const define = createDefine();

// Server functions take `page` from here. The build follows this re-export to the framework's
// `page`, so the name is not what makes it special.
export { page } from '@memoized-dom/server';
