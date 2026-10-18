import { createDefine } from '@memoized-dom/server';

export const define = createDefine<{
  /** Username of the signed-in reader, from the `conduit_user` cookie. */
  user: string | null;
}>();
