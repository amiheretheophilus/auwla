import { define } from './define';

/** The signed-in username travels in a plain cookie: a demo, not real auth. */
export const session = define.middleware((context, next) => {
  const cookie = context.request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)conduit_user=([^;]+)/.exec(cookie);
  context.state.user = match ? decodeURIComponent(match[1]!) : null;
  return next();
});
