import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { deskDatabase } from '../desk/storage';

function sessionSecret() {
  return process.env.BETTER_AUTH_SECRET?.trim() ?? '';
}

export function authConfigured() {
  return sessionSecret().length >= 32;
}

function createAuth() {
  const secret = sessionSecret();
  if (secret.length < 32) throw new Error('Set BETTER_AUTH_SECRET before enabling staff sign-in');

  const baseURL = process.env.BETTER_AUTH_URL?.trim() || 'http://127.0.0.1:3070';
  return betterAuth({
    appName: 'Triaxis',
    baseURL,
    secret,
    database: deskDatabase(),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 4 * 60 * 60,
      disableSessionRefresh: true,
    },
    advanced: {
      cookiePrefix: 'triaxis',
      useSecureCookies: new URL(baseURL).protocol === 'https:',
    },
    rateLimit: { enabled: true },
    telemetry: { enabled: false },
    plugins: [admin()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return instance ??= createAuth();
}

export async function getAnalyst(request: Request) {
  if (!authConfigured()) return null;

  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user.role === 'admin' ? session.user : null;
}

export async function isAnalyst(request: Request) {
  return (await getAnalyst(request)) !== null;
}
