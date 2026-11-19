// Who the signed-in member is and which axes they hold. Every member page and every signal
// read goes through here, so access is decided on the server and never only in the page.
import type { StaffRole } from '../../src/desk/analysis';
import { axes } from '../../src/desk/draft/model/signal-fields';
import { axisLabel } from '../../src/members/plans';
import type { AxisAccess, Member } from '../../src/members/membership';
import type { PublishedSignal } from '../../src/signals/signal-card';
import { authConfigured, getAuth, isStaffRole } from '../auth/auth';
import { listPublishedSignals } from '../desk/publications';
import { deskDatabase } from '../desk/storage';

export interface SignedInMember {
  member: Member;
  role: string;
}

/** The signed-in person, member or staff, or null for a visitor. */
export async function getMember(request: Request): Promise<SignedInMember | null> {
  if (!authConfigured()) {
    return null;
  }

  const session = await getAuth().api.getSession({ headers: request.headers });
  const user = session?.user;
  if (!user) {
    return null;
  }

  const role = typeof user.role === 'string' ? user.role : 'user';
  return {
    member: { id: user.id, name: user.name || user.email, email: user.email, staffRole: staffRoleOf(role) },
    role,
  };
}

function staffRoleOf(role: string): StaffRole | null {
  if (isStaffRole(role)) {
    return role;
  }
  return null;
}

/** Each axis, held or not, with when access ends. Admins hold every axis for life. */
export function accessFor(signedIn: SignedInMember): AxisAccess[] {
  if (signedIn.role === 'admin') {
    return axes.map(axis => ({ axis, label: axisLabel(axis), active: true, expiresAt: null }));
  }

  const now = new Date().toISOString();
  const rows = deskDatabase().query<{ axis: string; expires_at: string }, [string, string, string]>(`
    SELECT axis, MAX(expires_at) AS expires_at
    FROM subscriptions
    WHERE user_id = ? AND expires_at > ?
    GROUP BY axis
    HAVING MIN(starts_at) <= ?
  `).all(signedIn.member.id, now, now);

  return axes.map(axis => {
    const row = rows.find(candidate => candidate.axis === axis);
    if (!row) {
      return { axis, label: axisLabel(axis), active: false, expiresAt: '' };
    }
    return { axis, label: axisLabel(axis), active: true, expiresAt: row.expires_at };
  });
}

/** Posted signals on the axes `access` holds, newest first. Locked axes contribute nothing. */
export function signalsFor(access: AxisAccess[]): PublishedSignal[] {
  const held = new Set(access.filter(entry => entry.active).map(entry => entry.axis));
  if (held.size === 0) {
    return [];
  }
  return listPublishedSignals().filter(signal => held.has(signal.card.axis));
}
