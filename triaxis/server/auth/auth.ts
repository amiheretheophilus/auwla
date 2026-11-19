import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';

// Staff roles for Better Auth's admin plugin. Admins keep the plugin's account management;
// analysts are staff who work on the desk and manage no accounts.
const access = createAccessControl(defaultStatements);
const staffRoles = {
  admin: access.newRole(adminAc.statements),
  user: access.newRole(userAc.statements),
  analyst: access.newRole({ user: [], session: [] }),
};
import { deskDatabase } from '../desk/storage';
import type { StaffMember, StaffRole } from '../../src/desk/analysis';

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
      // Members sign up through `registerMember` (server/auth/routes.ts); the public
      // /api/auth route forwards only sign-in and sign-out. New accounts take the plain
      // `user` role, so a sign-up can never reach the desk.
      disableSignUp: false,
      minPasswordLength: 12,
      // Off while testing, at the owner's request. Turn on together with an email sender.
      requireEmailVerification: false,
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
    plugins: [admin({ ac: access, roles: staffRoles })],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return instance ??= createAuth();
}

/** Staff roles. An admin can change any analysis; an analyst changes their own. */
export function isStaffRole(role: unknown): role is StaffRole {
  return role === 'admin' || role === 'analyst';
}

/** The signed-in member of staff, or null for anyone else. */
export async function getAnalyst(request: Request): Promise<StaffMember | null> {
  if (!authConfigured()) return null;

  const session = await getAuth().api.getSession({ headers: request.headers });
  const user = session?.user;
  if (!user || !isStaffRole(user.role)) return null;
  return { id: user.id, name: user.name || user.email, role: user.role };
}

export async function isAnalyst(request: Request) {
  return (await getAnalyst(request)) !== null;
}
