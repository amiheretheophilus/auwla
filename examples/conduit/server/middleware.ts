import { getCookie } from '@memoized-dom/server';
import { define } from './define';

export const SESSION_COOKIE = 'conduit_user';

/** The signed-in username travels in an HttpOnly cookie: a demo, not real auth. */
export const session = define.middleware((context, next) => {
  context.state.user = getCookie(context.request, SESSION_COOKIE) ?? null;
  return next();
});
