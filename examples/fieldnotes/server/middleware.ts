import { define } from './define';

export const logger = define.middleware(async (context, next) => {
  const started = Date.now();
  const response = await next();
  console.log(
    `[http] ${context.request.method} ${context.url.pathname} → ${response.status} (${Date.now() - started}ms)`,
  );
  return response;
});

export const session = define.middleware((context, next) => {
  context.state.visitor =
    context.request.headers.get('x-visitor') ?? 'anonymous';
  return next();
});
