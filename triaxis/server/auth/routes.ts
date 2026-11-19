import { Hono } from 'hono';
import { error, json } from '@memoized-dom/server';
import { authConfigured, getAuth, isStaffRole } from './auth';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** A refusal with `message` for the form to show. Never cached. */
function refuse(message: string, status: number, headers: HeadersInit = privateHeaders) {
  return error({ message }, { status, headers });
}

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

/**
 * Better Auth answers 403 when the page's address is not one it trusts (`trustedOrigins` in
 * auth.ts). That is a setup problem, not a wrong password, so it says so, and the server log
 * names the address and the setting that fixes it.
 */
function originRefused(request: Request) {
  console.warn(
    `[triaxis] Better Auth refused a request from ${request.headers.get('origin') ?? 'an unknown origin'}. `
    + 'Open the site at BETTER_AUTH_URL, or add this address to BETTER_AUTH_TRUSTED_ORIGINS.',
  );
  return refuse('Sign-in is not set up for this address of the site. Try the address in the setup guide.', 403);
}

/** The JSON Better Auth sent with a successful answer, or null. */
async function readBody(response: Response): Promise<{ user?: { role?: unknown } } | null> {
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  return await response.json().catch(() => null) as { user?: { role?: unknown } } | null;
}

async function signIn(request: Request, audience: Audience = 'staff') {
  if (!isSameOrigin(request)) {
    return refuse('Sign in from the Triaxis site.', 403);
  }

  if (!authConfigured()) {
    return refuse('Run the local auth setup and restart the dev server to enable sign-in.', 503);
  }

  const response = await getAuth().handler(request);
  const body = await readBody(response);
  if (response.status === 403) {
    return originRefused(request);
  }

  // A member's password opens no desk. The session cookie is withheld, so nothing is signed in.
  if (response.ok && audience === 'staff' && !isStaffRole(body?.user?.role)) {
    return refuse('This sign-in is for Triaxis staff. Members sign in at /sign-in.', 403);
  }

  if (response.status === 429) {
    const headers = new Headers(privateHeaders);
    const retry = response.headers.get('Retry-After');
    if (retry) headers.set('Retry-After', retry);
    return refuse('Too many attempts. Try signing in again shortly.', 429, headers);
  }

  if (response.status >= 500) {
    return refuse('Sign-in is temporarily unavailable.', 503);
  }

  if (!response.ok) {
    return refuse('The email or password is incorrect.', 401);
  }

  // Forward the cookies while keeping Better Auth's session token out of the JSON payload.
  // `staff` tells the member sign-in form to open the desk instead of the member pages.
  const signedIn = json({ signedIn: true as const, staff: isStaffRole(body?.user?.role) }, { headers: privateHeaders });
  copyCookies(response, signedIn);
  return signedIn;
}

function validCredentials(email: unknown, password: unknown): email is string {
  return typeof email === 'string' && typeof password === 'string' && email.length <= 254 && password.length <= 128;
}

export function loginAnalyst(request: Request, email: string, password: string) {
  if (!validCredentials(email, password)) {
    return refuse('Enter a valid email and password.', 400);
  }

  return signIn(authRequest(request, '/api/auth/sign-in/email', { email, password }), 'staff');
}

export function loginMember(request: Request, email: string, password: string) {
  if (!validCredentials(email, password)) {
    return refuse('Enter a valid email and password.', 400);
  }

  return signIn(authRequest(request, '/api/auth/sign-in/email', { email, password }), 'members');
}

/** Creates a member account and signs it in. Email verification is off while testing. */
export async function registerMember(request: Request, name: string, email: string, password: string) {
  if (!isSameOrigin(request)) {
    return refuse('Sign up from the Triaxis site.', 403);
  }

  if (!authConfigured()) {
    return refuse('Sign-up is not available yet.', 503);
  }

  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (cleanName.length < 2 || cleanName.length > 80) {
    return refuse('Enter your name, between 2 and 80 characters.', 400);
  }

  if (!validCredentials(cleanEmail, password) || !cleanEmail.includes('@')) {
    return refuse('Enter a valid email address.', 400);
  }

  if (password.length < 12) {
    return refuse('Use a password of at least 12 characters.', 400);
  }

  const response = await getAuth().handler(authRequest(request, '/api/auth/sign-up/email', {
    name: cleanName,
    email: cleanEmail,
    password,
  }));
  await response.body?.cancel();

  if (response.status === 403) {
    return originRefused(request);
  }
  if (response.status === 429) {
    return refuse('Too many attempts. Try again shortly.', 429);
  }

  if (response.status === 422) {
    // Better Auth's answer for an email that already has an account.
    return refuse('That email already has an account. Sign in instead.', 409);
  }

  if (response.status === 400) {
    return refuse('Check your name, email and password, then try again.', 400);
  }

  if (!response.ok) {
    console.warn(`[triaxis] Better Auth answered sign-up with ${response.status}.`);
    return refuse('Sign-up is temporarily unavailable.', 503);
  }

  const signedUp = json({ signedUp: true as const }, { headers: privateHeaders });
  copyCookies(response, signedUp);
  return signedUp;
}

async function signOut(request: Request) {
  if (!isSameOrigin(request)) {
    return refuse('Sign out from the Triaxis site.', 403);
  }

  if (!authConfigured()) {
    return refuse('Sign-in is unavailable.', 503);
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
