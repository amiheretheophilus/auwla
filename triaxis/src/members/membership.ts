// What a member holds, as the member pages and the desk's payments page show it.
// `server/members/` builds these; access is always decided on the server.
import type { StaffRole } from '../desk/analysis';
import type { PublishedSignal } from '../signals/signal-card';

export interface Member {
  id: string;
  name: string;
  email: string;
  /** The staff role of someone on staff, or null for a member. Admins hold every axis for life. */
  staffRole: StaffRole | null;
}

/** One axis and whether the member holds it. */
export interface AxisAccess {
  axis: string;
  label: string;
  active: boolean;
  /** When access ends, or null for lifetime access (admins). Empty when not held. */
  expiresAt: string | null;
}

export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentSummary {
  id: number;
  planId: string;
  axes: string[];
  months: number;
  amount: number;
  method: string;
  reference: string;
  status: PaymentStatus;
  createdAt: string;
  decidedAt: string | null;
}

/** A payment on the desk's payments page, with who paid. */
export interface PaymentForReview extends PaymentSummary {
  member: { id: string; name: string; email: string };
  decidedBy: string | null;
}

export interface MemberHome {
  member: Member;
  access: AxisAccess[];
  payments: PaymentSummary[];
  /** Posted signals on the axes the member holds, newest first. Locked axes contribute none. */
  signals: PublishedSignal[];
}

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatDay(value: string): string {
  return dateFormat.format(new Date(value));
}
