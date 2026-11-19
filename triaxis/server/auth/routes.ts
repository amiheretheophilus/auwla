import { Hono } from 'hono';
import { json } from '@memoized-dom/server';
import { authConfigured, getAuth, isStaffRole } from './auth';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export function isSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}

function authRequest(request: Request, path: string, body?: { email: string; password: string; name?: string }) {
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

/** Who may finish signing in: staff only on the desk, anyone on the member pages. */
type Audience = 'staff' | 'members';

async function signIn(request: Request, audience: Audience = 'staff') {
  if (!isSameOrigin(request)) {
    return json({ message: 'Sign in from the Triaxis site.' }, { status: 403, headers: privateHeaders });
  }
  if (!authConfigured()) {
    return json({ message: 'Run the local auth setup and restart the dev server to enable sign-in.' }, {
      status: 503,
      headers: privateHeaders,
    });
  }

  const response = await getAuth().handler(request);
  const body = response.ok ? await response.json().catch(() => null) as { user?: { role?: unknown } } | null : null;
  if (!response.ok) {
    await response.body?.cancel();
  }

  // A member's password opens no desk. The session cookie is withheld, so nothing is signed in.
  if (response.ok && audience === 'staff' && !isStaffRole(body?.user?.role)) {
    return json({ message: 'This sign-in is for Triaxis staff. Members sign in at /sign-in.' }, {
      status: 403,
      headers: privateHeaders,
    });
  }

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

function validCredentials(email: unknown, password: unknown): email is string {
  return typeof email === 'string' && typeof password === 'string' && email.length <= 254 && password.length <= 128;
}

export function loginAnalyst(request: Request, email: string, password: string) {
  if (!validCredentials(email, password)) {
    return json({ message: 'Enter a valid email and password.' }, { status: 400, headers: privateHeaders });
  }

  return signIn(authRequest(request, '/api/auth/sign-in/email', { email, password }), 'staff');
}

export function loginMember(request: Request, email: string, password: string) {
  if (!validCredentials(email, password)) {
    return json({ message: 'Enter a valid email and password.' }, { status: 400, headers: privateHeaders });
  }

  return signIn(authRequest(request, '/api/auth/sign-in/email', { email, password }), 'members');
}

/** Creates a member account and signs it in. Email verification is off while testing. */
export async function registerMember(request: Request, name: string, email: string, password: string) {
  if (!isSameOrigin(request)) {
    return json({ message: 'Sign up from the Triaxis site.' }, { status: 403, headers: privateHeaders });
  }
  if (!authConfigured()) {
    return json({ message: 'Sign-up is not available yet.' }, { status: 503, headers: privateHeaders });
  }

  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (cleanName.length < 2 || cleanName.length > 80) {
    return json({ message: 'Enter your name, between 2 and 80 characters.' }, { status: 400, headers: privateHeaders });
  }
  if (!validCredentials(cleanEmail, password) || !cleanEmail.includes('@')) {
    return json({ message: 'Enter a valid email address.' }, { status: 400, headers: privateHeaders });
  }
  if (password.length < 12) {
    return json({ message: 'Use a password of at least 12 characters.' }, { status: 400, headers: privateHeaders });
  }

  const response = await getAuth().handler(authRequest(request, '/api/auth/sign-up/email', {
    name: cleanName,
    email: cleanEmail,
    password,
  }));
  await response.body?.cancel();

  if (response.status === 429) {
    return json({ message: 'Too many attempts. Try again shortly.' }, { status: 429, headers: privateHeaders });
  }
  if (response.status === 422) {
    // Better Auth's answer for an email that already has an account.
    return json({ message: 'That email already has an account. Sign in instead.' }, { status: 409, headers: privateHeaders });
  }
  if (response.status === 400) {
    return json({ message: 'Check your name, email and password, then try again.' }, { status: 400, headers: privateHeaders });
  }
  if (!response.ok) {
    return json({ message: 'Sign-up is temporarily unavailable.' }, { status: 503, headers: privateHeaders });
  }

  const signedUp = json({ signedUp: true as const }, { headers: privateHeaders });
  copyCookies(response, signedUp);
  return signedUp;
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

async function signOutTo(request: Request, location: string) {
  const signedOut = await signOut(authRequest(request, '/api/auth/sign-out'));
  if (!signedOut.ok) return signedOut;
  await signedOut.body?.cancel();

  const redirect = new Response(null, {
    status: 303,
    headers: { ...privateHeaders, Location: location },
  });
  copyCookies(signedOut, redirect);
  return redirect;
}

export function leaveDesk(request: Request) {
  return signOutTo(request, '/desk/sign-in');
}

export function leaveMembers(request: Request) {
  return signOutTo(request, '/');
}

export const authRoutes = new Hono()
  .post('/api/auth/sign-in/email', context => signIn(context.req.raw))
  .post('/api/auth/sign-out', context => signOut(context.req.raw));
