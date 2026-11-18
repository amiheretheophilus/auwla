import { Hono } from 'hono';
import { json } from '@memoized-dom/server';
import { authConfigured, getAuth } from './auth';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export function isSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}

function authRequest(request: Request, path: string, body?: { email: string; password: string }) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  if (body) headers.set('content-type', 'application/json');

  return new Request(new URL(path, request.url), {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function copyCookies(from: Response, to: Response) {
  for (const cookie of from.headers.getSetCookie()) {
    to.headers.append('Set-Cookie', cookie);
  }
}

async function signIn(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ message: 'Sign in from the Triaxis desk.' }, { status: 403, headers: privateHeaders });
  }
  if (!authConfigured()) {
    return json({ message: 'Run the local auth setup and restart the dev server to enable sign-in.' }, {
      status: 503,
      headers: privateHeaders,
    });
  }

  const response = await getAuth().handler(request);
  await response.body?.cancel();
  if (response.status === 429) {
    const headers = new Headers(privateHeaders);
    const retry = response.headers.get('Retry-After');
    if (retry) headers.set('Retry-After', retry);
    return json({ message: 'Too many attempts. Try signing in again shortly.' }, { status: 429, headers });
  }
  if (response.status >= 500) {
    return json({ message: 'Staff sign-in is temporarily unavailable.' }, { status: 503, headers: privateHeaders });
  }
  if (!response.ok) {
    return json({ message: 'The email or password is incorrect.' }, { status: 401, headers: privateHeaders });
  }

  // Forward the cookies while keeping Better Auth's session token out of the JSON payload.
  const signedIn = json({ signedIn: true as const }, { headers: privateHeaders });
  copyCookies(response, signedIn);
  return signedIn;
}

export function loginAnalyst(request: Request, email: string, password: string) {
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 128) {
    return json({ message: 'Enter a valid email and password.' }, { status: 400, headers: privateHeaders });
  }

  return signIn(authRequest(request, '/api/auth/sign-in/email', { email, password }));
}

async function signOut(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ message: 'Sign out from the Triaxis desk.' }, { status: 403, headers: privateHeaders });
  }
  if (!authConfigured()) {
    return json({ message: 'Staff sign-in is unavailable.' }, { status: 503, headers: privateHeaders });
  }

  return getAuth().handler(request);
}

export async function leaveDesk(request: Request) {
  const signedOut = await signOut(authRequest(request, '/api/auth/sign-out'));
  if (!signedOut.ok) return signedOut;
  await signedOut.body?.cancel();

  const redirect = new Response(null, {
    status: 303,
    headers: { ...privateHeaders, Location: '/desk/sign-in' },
  });
  copyCookies(signedOut, redirect);
  return redirect;
}

export const authRoutes = new Hono()
  .post('/api/auth/sign-in/email', context => signIn(context.req.raw))
  .post('/api/auth/sign-out', context => signOut(context.req.raw));
