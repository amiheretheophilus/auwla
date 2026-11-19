// Payments in version 1 (brief, section 5): the member pays by bank, mobile money or USDT and
// submits the reference; an admin approves or rejects it, once. Approval adds the plan's time to
// each axis it covers, on top of any access the member already holds.
import { findPlan, isPaymentMethod, paymentMethods, planAxes } from '../../src/members/plans';
import type { PaymentForReview, PaymentStatus, PaymentSummary } from '../../src/members/membership';
import type { StaffMember } from '../../src/desk/analysis';
import { deskDatabase } from '../desk/storage';

interface PaymentRow {
  id: number;
  user_id: string;
  plan_id: string;
  axes: string;
  months: number;
  amount: number;
  method: string;
  reference: string;
  status: PaymentStatus;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  member_name?: string | null;
  member_email?: string | null;
  decider_name?: string | null;
}

/** A member may have this many payments waiting at once, so the queue cannot be flooded. */
const pendingLimit = 3;

function summaryOf(row: PaymentRow): PaymentSummary {
  return {
    id: row.id,
    planId: row.plan_id,
    axes: JSON.parse(row.axes) as string[],
    months: row.months,
    amount: row.amount,
    method: row.method,
    reference: row.reference,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/** The payment details the owner has set, by method. Unset details are null. */
export function paymentInstructions() {
  const configured: Record<string, string | undefined> = {
    bank: process.env.TRIAXIS_PAY_BANK,
    mobile_money: process.env.TRIAXIS_PAY_MOBILE_MONEY,
    usdt: process.env.TRIAXIS_PAY_USDT,
  };
  return paymentMethods.map(method => ({
    method: method.id,
    label: method.label,
    details: configured[method.id]?.trim() || null,
  }));
}

export function submitPayment(userId: string, planId: string, chosenAxis: string, method: string, rawReference: string) {
  const plan = findPlan(planId);
  if (!plan) {
    return { ok: false, message: 'Choose a plan that is on sale.' } as const;
  }

  const covered = planAxes(plan, chosenAxis);
  if (covered.length === 0) {
    return { ok: false, message: 'Choose the axis this plan is for.' } as const;
  }
  if (!isPaymentMethod(method)) {
    return { ok: false, message: 'Choose how you paid.' } as const;
  }

  const reference = typeof rawReference === 'string' ? rawReference.trim() : '';
  if (reference.length < 3 || reference.length > 120) {
    return { ok: false, message: 'Enter the payment reference, between 3 and 120 characters.' } as const;
  }

  const database = deskDatabase();
  return database.transaction(() => {
    const waiting = database.query<{ count: number }, [string]>(`
      SELECT COUNT(*) AS count FROM payments WHERE user_id = ? AND status = 'pending'
    `).get(userId)?.count ?? 0;
    if (waiting >= pendingLimit) {
      return { ok: false, message: `You already have ${waiting} payments waiting for approval. Wait for those to be checked first.` } as const;
    }

    const row = database.query<PaymentRow, [string, string, string, number, number, string, string, string]>(`
      INSERT INTO payments (user_id, plan_id, axes, months, amount, currency, method, reference, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, 'pending', ?)
      RETURNING *
    `).get(userId, plan.id, JSON.stringify(covered), plan.months, plan.price!, method, reference, new Date().toISOString());
    if (!row) {
      throw new Error('Saving the payment did not return it');
    }

    return { ok: true, payment: summaryOf(row) } as const;
  }).immediate();
}

export function listMemberPayments(userId: string): PaymentSummary[] {
  const rows = deskDatabase().query<PaymentRow, [string]>(`
    SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(userId);
  return rows.map(summaryOf);
}

/** Every payment for the desk, waiting ones first. */
export function listPaymentsForReview(): PaymentForReview[] {
  const rows = deskDatabase().query<PaymentRow, []>(`
    SELECT p.*, u.name AS member_name, u.email AS member_email, d.name AS decider_name
    FROM payments p
    LEFT JOIN "user" u ON u.id = p.user_id
    LEFT JOIN "user" d ON d.id = p.decided_by
    ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC
    LIMIT 200
  `).all();

  return rows.map(row => ({
    ...summaryOf(row),
    member: { id: row.user_id, name: row.member_name || row.member_email || 'Deleted member', email: row.member_email ?? '' },
    decidedBy: row.decider_name ?? null,
  }));
}

/** `start` plus whole months, keeping the day of the month where that month has it. */
export function addMonths(start: string, months: number): string {
  const date = new Date(start);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function decidePayment(id: number, decision: 'approved' | 'rejected', admin: StaffMember) {
  if (admin.role !== 'admin') {
    return { ok: false, message: 'Only an admin can decide payments.' } as const;
  }
  if (!Number.isSafeInteger(id) || id < 1) {
    return { ok: false, message: 'That payment does not exist.' } as const;
  }

  const database = deskDatabase();
  return database.transaction(() => {
    const now = new Date().toISOString();
    // Deciding only a waiting payment makes a second decision, or a double click, a no-op.
    const row = database.query<PaymentRow, [string, string, string, number]>(`
      UPDATE payments SET status = ?, decided_by = ?, decided_at = ?
      WHERE id = ? AND status = 'pending'
      RETURNING *
    `).get(decision, admin.id, now, id);
    if (!row) {
      return { ok: false, message: 'This payment was already decided.' } as const;
    }

    if (decision === 'approved') {
      for (const axis of JSON.parse(row.axes) as string[]) {
        // Time is added where the member's current access ends, or from now.
        const current = database.query<{ expires_at: string | null }, [string, string, string]>(`
          SELECT MAX(expires_at) AS expires_at FROM subscriptions WHERE user_id = ? AND axis = ? AND expires_at > ?
        `).get(row.user_id, axis, now);
        const startsAt = current?.expires_at ?? now;
        database.query(`
          INSERT INTO subscriptions (user_id, axis, starts_at, expires_at, source, payment_id)
          VALUES (?, ?, ?, ?, 'payment', ?)
        `).run(row.user_id, axis, startsAt, addMonths(startsAt, row.months), row.id);
      }
    }

    return { ok: true } as const;
  }).immediate();
}
